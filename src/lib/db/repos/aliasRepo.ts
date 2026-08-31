import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { makeKv } from "../helpers/kvStore";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");

// modelAliases: key=alias, value=modelString
export async function getModelAliases(): Promise<Record<string, unknown>> {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias: string, model: unknown): Promise<void> {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias: string): Promise<void> {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias: string, id: string, type: string): string {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels(): Promise<unknown[]> {
  const all: Record<string, unknown> = await customKv.getAll();
  return Object.values(all);
}

export interface CustomModelInput {
  providerAlias: string;
  id: string;
  type?: string;
  name?: string;
  source?: "manual" | "discovered";
  metadata?: Record<string, unknown>;
}

// Reconciles a provider's live catalogue in one SQLite transaction. Manual
// entries are deliberately left alone; a refresh owns only its discovered
// snapshot. Keeping this in the repository avoids an HTTP request per model
// when large providers (such as OpenRouter) return hundreds of entries.
export async function syncDiscoveredCustomModels(providerAlias: string, models: CustomModelInput[]): Promise<void> {
  const desired = new Map(
    models
      .filter((model) => model.id && (model.type || "llm") === "llm")
      .map((model) => [customKey(providerAlias, model.id, "llm"), {
        ...model,
        providerAlias,
        type: "llm",
        source: "discovered" as const,
      }]),
  );
  const db = await getAdapter();

  db.transaction(() => {
    const rows = db.all("SELECT key, value FROM kv WHERE scope = 'customModels'") as Array<{ key: string; value: string }>;
    const existing = new Map(rows.map((row) => [row.key, parseJson<Record<string, unknown>>(row.value, {}) || {}]));

    for (const [key, value] of existing) {
      if (
        value.providerAlias === providerAlias &&
        (value.kind || value.type || "llm") === "llm" &&
        value.source === "discovered" &&
        !desired.has(key)
      ) {
        db.run("DELETE FROM kv WHERE scope = 'customModels' AND key = ?", [key]);
      }
    }

    for (const [key, model] of desired) {
      const current = existing.get(key);
      // A manually curated entry takes precedence over discovery.
      if (current && current.source !== "discovered") continue;
      const value = stringifyJson({
        ...(current || {}),
        ...(model.metadata || {}),
        providerAlias,
        id: model.id,
        type: "llm",
        name: model.name || model.id,
        source: "discovered",
      });
      db.run(
        "INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    }
  });
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name, source = "manual", metadata = {} }: CustomModelInput): Promise<boolean> {
  const k: string = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added: boolean = false;
  db.transaction(() => {
    const row: Record<string, unknown> | undefined = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) {
      // A refresh owns only entries it previously discovered. Keep manually
      // curated models untouched, but update discovery metadata so stale names
      // and capabilities do not survive after an upstream catalogue change.
      if (source === "discovered") {
        const existing = parseJson<Record<string, unknown>>((row.value as string) || "{}", {}) || {};
        if (existing.source === "discovered") {
          const value = stringifyJson({ ...existing, ...metadata, providerAlias, id, type, name: name || id, source });
          db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [value, k]);
        }
      }
      return;
    }
    const value: string = stringifyJson({ ...metadata, providerAlias, id, type, name: name || id, source });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

interface CustomModelDeleteInput {
  providerAlias: string;
  id: string;
  type?: string;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }: CustomModelDeleteInput): Promise<void> {
  await customKv.remove(customKey(providerAlias, id, type));
}
