import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { makeKv } from "../helpers/kvStore";
import { chunked, placeholderList, valuesRows } from "../helpers/batch";

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

// Metadata fields a discovery snapshot is allowed to persist on a custom model.
// Owned here because both /api/models/custom and /api/models/discovered write
// through this repo; keeping one copy stops the two routes from drifting.
const DISCOVERED_MODEL_METADATA_KEYS: ReadonlySet<string> = new Set([
  "description", "context_length", "contextLength", "contextWindow", "max_output_tokens", "maxOutputTokens",
  "capabilities", "modalities", "input_modalities", "output_modalities", "owned_by", "provider",
  "upstreamModelId", "quotaFamily", "version",
]);

/** Keep only the metadata keys a discovered model may carry. */
export function pickDiscoveredMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => DISCOVERED_MODEL_METADATA_KEYS.has(key)));
}

export interface CustomModelInput {
  providerAlias: string;
  id: string;
  type?: string;
  name?: string;
  source?: "manual" | "discovered";
  metadata?: Record<string, unknown>;
}

// Reconciles a provider's live catalogue in one transaction. Manual entries are
// deliberately left alone; a refresh owns only its discovered snapshot. Keeping
// this in the repository avoids an HTTP request per model when large providers
// (such as OpenRouter) return hundreds of entries.
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

  await db.transaction(async () => {
    const rows = await db.all("SELECT key, value FROM kv WHERE userId = ? AND scope = 'customModels'", [currentTenantId()]) as Array<{ key: string; value: string }>;
    const existing = new Map(rows.map((row) => [row.key, parseJson<Record<string, unknown>>(row.value, {}) || {}]));

    const stale = [...existing]
      .filter(([key, value]) =>
        value.providerAlias === providerAlias &&
        (value.kind || value.type || "llm") === "llm" &&
        value.source === "discovered" &&
        !desired.has(key))
      .map(([key]) => key);

    for (const batch of chunked(stale)) {
      await db.run(
        `DELETE FROM kv WHERE userId = ? AND scope = 'customModels' AND key IN (${placeholderList(batch.length)})`,
        [currentTenantId(), ...batch],
      );
    }

    const upserts: Array<[string, string]> = [];
    for (const [key, model] of desired) {
      const current = existing.get(key);
      // A manually curated entry takes precedence over discovery.
      if (current && current.source !== "discovered") continue;
      upserts.push([key, stringifyJson({
        ...(current || {}),
        ...(model.metadata || {}),
        providerAlias,
        id: model.id,
        type: "llm",
        name: model.name || model.id,
        source: "discovered",
      })]);
    }

    // `desired` is keyed by model, so no batch can hit the same row twice —
    // which ON CONFLICT DO UPDATE would reject within a single statement.
    for (const batch of chunked(upserts)) {
      await db.run(
        `INSERT INTO kv(userId, scope, key, value) VALUES ${valuesRows(batch.length, "(?, 'customModels', ?, ?)")} ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`,
        batch.flatMap(([key, value]) => [currentTenantId(), key, value]),
      );
    }
  });
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name, source = "manual", metadata = {} }: CustomModelInput): Promise<boolean> {
  const k: string = customKey(providerAlias, id, type);
  const db = await getAdapter();
  const userId = currentTenantId();
  let added: boolean = false;
  await db.transaction(async () => {
    const row: Record<string, unknown> | undefined = await db.get(`SELECT value FROM kv WHERE userId = ? AND scope = 'customModels' AND key = ?`, [userId, k]);
    if (row) {
      // A refresh owns only entries it previously discovered. Keep manually
      // curated models untouched, but update discovery metadata so stale names
      // and capabilities do not survive after an upstream catalogue change.
      if (source === "discovered") {
        const existing = parseJson<Record<string, unknown>>((row.value as string) || "{}", {}) || {};
        if (existing.source === "discovered") {
          const value = stringifyJson({ ...existing, ...metadata, providerAlias, id, type, name: name || id, source });
          await db.run(`UPDATE kv SET value = ? WHERE userId = ? AND scope = 'customModels' AND key = ?`, [value, userId, k]);
        }
      }
      return;
    }
    const value: string = stringifyJson({ ...metadata, providerAlias, id, type, name: name || id, source });
    await db.run(`INSERT INTO kv(userId, scope, key, value) VALUES(?, 'customModels', ?, ?)`, [userId, k, value]);
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

/**
 * Removes every custom model of one provider, and its aliases, in a few
 * statements.
 *
 * "Clear All Models" sent one DELETE request per model and one per alias — with
 * a discovered catalogue that is hundreds of requests, each its own round-trip.
 * The keys are read once and deleted in batches.
 */
export async function deleteCustomModelsByProvider(providerAlias: string, type: string = "llm"): Promise<number> {
  const db = await getAdapter();
  const userId = currentTenantId();
  const rows = await db.all("SELECT key, value FROM kv WHERE userId = ? AND scope = 'customModels'", [userId]) as Array<{ key: string; value: string }>;
  const keys = rows
    .filter((row) => {
      const value = parseJson<Record<string, unknown>>(row.value, {}) || {};
      return value.providerAlias === providerAlias && String(value.kind || value.type || "llm") === type;
    })
    .map((row) => row.key);
  if (keys.length === 0) return 0;

  let changes = 0;
  await db.transaction(async () => {
    for (const batch of chunked(keys)) {
      changes += (await db.run(
        `DELETE FROM kv WHERE userId = ? AND scope = 'customModels' AND key IN (${placeholderList(batch.length)})`,
        [userId, ...batch],
      )).changes;
    }
  });
  return changes;
}

/** Removes every alias pointing at `providerAlias/...`, in one statement per batch. */
export async function deleteModelAliasesByProvider(providerAlias: string): Promise<number> {
  const db = await getAdapter();
  const userId = currentTenantId();
  const rows = await db.all("SELECT key, value FROM kv WHERE userId = ? AND scope = 'modelAliases'", [userId]) as Array<{ key: string; value: string }>;
  const prefix = `${providerAlias}/`;
  const keys = rows
    .filter((row) => String(parseJson<unknown>(row.value, "") ?? "").startsWith(prefix))
    .map((row) => row.key);
  if (keys.length === 0) return 0;

  let changes = 0;
  await db.transaction(async () => {
    for (const batch of chunked(keys)) {
      changes += (await db.run(
        `DELETE FROM kv WHERE userId = ? AND scope = 'modelAliases' AND key IN (${placeholderList(batch.length)})`,
        [userId, ...batch],
      )).changes;
    }
  });
  return changes;
}
