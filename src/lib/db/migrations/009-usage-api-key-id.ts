interface DbAdapter {
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number };
}

/**
 * Stop keeping raw API keys in the usage tables.
 *
 * `usageHistory` has no pruning of any kind, so a key written there outlives
 * every rotation — and the same secret is embedded in the `usageDaily`
 * aggregate twice over: once inside the composite `byApiKey` map key
 * (`${apiKey}|${model}|${provider}`) and once in that entry's `meta.apiKey`.
 *
 * Both become the key's row id, which is a stable non-secret handle. Readers
 * resolve either form (see `loadReferenceMaps` in usageAnalytics), so a row
 * this migration cannot resolve keeps working — an unknown key is left verbatim
 * rather than blanked, because losing the value would lose the attribution and
 * that is worse than keeping a string that no longer opens anything.
 *
 * Everything here runs inside the migration transaction, so a throw on one row
 * rolls back every other row and pins the install at the previous schema
 * version, failing again on every boot. That is what migration 008 nearly did.
 * Hence the non-object guards: JSON.parse succeeds on "null", "42" and
 * '"text"', so a parse try/catch does not cover them.
 */
export default {
  version: 9,
  name: "usage-api-key-id",
  up(db: DbAdapter): void {
    const idByKey = new Map<string, string>();
    const knownIds = new Set<string>();
    for (const row of db.all("SELECT id, key FROM apiKeys")) {
      const id = typeof row.id === "string" ? row.id : "";
      const key = typeof row.key === "string" ? row.key : "";
      if (!id) continue;
      knownIds.add(id);
      if (key) idByKey.set(key, id);
    }

    // Nothing to map onto: no keys exist, so no stored value can be resolved.
    if (idByKey.size === 0) return;

    for (const row of db.all("SELECT id, apiKey FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey != ''")) {
      const stored = typeof row.apiKey === "string" ? row.apiKey : "";
      if (!stored || knownIds.has(stored)) continue;
      const id = idByKey.get(stored);
      if (!id) continue;
      db.run("UPDATE usageHistory SET apiKey = ? WHERE id = ?", [id, row.id]);
    }

    for (const row of db.all("SELECT dateKey, data FROM usageDaily")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(row.data || "{}"));
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const day = parsed as Record<string, unknown>;

      const byApiKey = day.byApiKey;
      if (!byApiKey || typeof byApiKey !== "object" || Array.isArray(byApiKey)) continue;

      let changed = false;
      const rewritten: Record<string, unknown> = {};
      for (const [mapKey, value] of Object.entries(byApiKey as Record<string, unknown>)) {
        // The composite key is `${apiKey}|${model}|${provider}`, and an api key
        // never contains "|", so the first segment is the whole stored value.
        const separator = mapKey.indexOf("|");
        const stored = separator === -1 ? mapKey : mapKey.slice(0, separator);
        const id = idByKey.get(stored);

        let nextKey = mapKey;
        let nextValue = value;

        if (id) {
          nextKey = separator === -1 ? id : `${id}${mapKey.slice(separator)}`;
          changed = true;
        }

        if (nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)) {
          const entry = nextValue as Record<string, unknown>;
          const meta = entry.meta;
          if (meta && typeof meta === "object" && !Array.isArray(meta)) {
            const metaObj = meta as Record<string, unknown>;
            const metaKey = typeof metaObj.apiKey === "string" ? metaObj.apiKey : "";
            const metaId = metaKey ? idByKey.get(metaKey) : undefined;
            if (metaId) {
              nextValue = { ...entry, meta: { ...metaObj, apiKey: metaId } };
              changed = true;
            }
          }
        }

        rewritten[nextKey] = nextValue;
      }

      if (!changed) continue;
      db.run("UPDATE usageDaily SET data = ? WHERE dateKey = ?", [
        JSON.stringify({ ...day, byApiKey: rewritten }),
        row.dateKey,
      ]);
    }
  },
};
