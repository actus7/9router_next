import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { ALIAS_TO_ID } from "@/shared/constants/providers";

/**
 * Removes a model the provider stopped listing from every place that names it.
 *
 * Called by `syncDiscoveredCustomModels` inside its transaction, so the
 * catalogue and its references change together or not at all. Covered: combos
 * (`models`, smart lanes with their index-aligned entries, classifier model),
 * model aliases, the disabled list, access-policy allowlists and the capacity
 * adapter. Not covered on purpose: history (usage, conversations) and
 * self-expiring state (cooldowns, smart profiles cache).
 *
 * A combo or allowlist left empty stays empty — the operator's to delete; an
 * allowlist of only dead models allowed nothing callable already.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** Lower-cased `alias/id` and `providerId/id` — both spellings a client may store. */
export function deadModelKeys(alias: string, ids: string[]): Set<string> {
  const prefixes = [alias, ALIAS_TO_ID[alias]].filter((p): p is string => !!p);
  return new Set(ids.flatMap((id) => prefixes.map((p) => `${p}/${id}`.toLowerCase())));
}

const isDead = (value: unknown, dead: Set<string>): boolean => typeof value === "string" && dead.has(value.toLowerCase());

/** The list without dead entries, or null when nothing was dropped. */
function pruneList(list: unknown, dead: Set<string>): unknown[] | null {
  if (!Array.isArray(list) || !list.some((item) => isDead(item, dead))) return null;
  return list.filter((item) => !isDead(item, dead));
}

function pruneRouting(routing: Json, dead: Set<string>): Json | null {
  let changed = false;
  const next: Json = structuredClone(routing);
  const overrides = isRecord(next.overrides) ? next.overrides : {};
  const entries = isRecord(next.entries) ? next.entries : {};
  for (const [need, tiers] of Object.entries(overrides)) {
    if (!isRecord(tiers)) continue;
    for (const [tier, lane] of Object.entries(tiers)) {
      if (!Array.isArray(lane) || !lane.some((m) => isDead(m, dead))) continue;
      changed = true;
      const keep = lane.map((m) => !isDead(m, dead));
      tiers[tier] = lane.filter((_, i) => keep[i]);
      const laneEntries = isRecord(entries[need]) ? (entries[need] as Json)[tier] : undefined;
      if (Array.isArray(laneEntries)) (entries[need] as Json)[tier] = laneEntries.filter((_, i) => keep[i]);
    }
  }
  if (isRecord(next.classifier) && isDead(next.classifier.model, dead)) {
    next.classifier.model = "auto";
    changed = true;
  }
  return changed ? next : null;
}

/** The combo without dead references, or null when it names none. */
export function pruneComboReferences(
  combo: { models: unknown[]; routing: Json | null },
  dead: Set<string>,
): { models: unknown[]; routing: Json | null } | null {
  const models = pruneList(combo.models, dead);
  const routing = combo.routing ? pruneRouting(combo.routing, dead) : null;
  if (!models && !routing) return null;
  return { models: models ?? combo.models, routing: routing ?? combo.routing };
}

const KV_UPSERT = `INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`;

/** Prunes every reference to `alias`'s dead `ids`. Run inside the caller's transaction. */
export async function pruneModelReferences(alias: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const dead = deadModelKeys(alias, ids);
  const deadIds = new Set(ids);
  const db = await getAdapter();
  const tenant = currentTenantId();
  const now = new Date().toISOString();

  const combos = await db.all(`SELECT id, models, routing FROM combos WHERE userId = ?`, [tenant]) as Array<{ id: string; models: string; routing: string | null }>;
  for (const row of combos) {
    const pruned = pruneComboReferences({
      models: parseJson(row.models, []) as unknown[],
      routing: row.routing ? parseJson(row.routing, null) as Json | null : null,
    }, dead);
    if (!pruned) continue;
    await db.run(
      `UPDATE combos SET models = ?, routing = ?, updatedAt = ? WHERE userId = ? AND id = ?`,
      [stringifyJson(pruned.models), pruned.routing ? stringifyJson(pruned.routing) : null, now, tenant, row.id],
    );
  }

  const aliases = await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = ?`, [tenant, "modelAliases"]) as Array<{ key: string; value: string }>;
  for (const row of aliases) {
    if (!isDead(parseJson(row.value, null), dead)) continue;
    await db.run(`DELETE FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [tenant, "modelAliases", row.key]);
  }

  const disabledKeys = new Set([alias, ALIAS_TO_ID[alias]].filter(Boolean));
  const disabled = await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = ?`, [tenant, "disabledModels"]) as Array<{ key: string; value: string }>;
  for (const row of disabled) {
    if (!disabledKeys.has(row.key)) continue;
    const list = parseJson(row.value, []) as string[];
    if (!list.some((id) => deadIds.has(id))) continue;
    await db.run(KV_UPSERT, [tenant, "disabledModels", row.key, stringifyJson(list.filter((id) => !deadIds.has(id)))]);
  }

  const policies = await db.all(`SELECT subjectType, subjectId, policy FROM accessPolicies WHERE userId = ?`, [tenant]) as Array<{ subjectType: string; subjectId: string; policy: string }>;
  for (const row of policies) {
    const policy = parseJson(row.policy, {}) as Json;
    const models = pruneList(policy.models, dead);
    if (!models) continue;
    await db.run(
      `UPDATE accessPolicies SET policy = ?, updatedAt = ? WHERE userId = ? AND subjectType = ? AND subjectId = ?`,
      [JSON.stringify({ ...policy, models }), now, tenant, row.subjectType, row.subjectId],
    );
  }

  const settingsRow = await db.get(`SELECT data FROM settings WHERE userId = ?`, [tenant]) as { data: string } | undefined;
  const settings = settingsRow ? parseJson(settingsRow.data, {}) as Json : null;
  if (settings && isRecord(settings.capacityAdapter)) {
    let changed = false;
    const adapter = structuredClone(settings.capacityAdapter);
    for (const slot of Object.values(adapter)) {
      if (!isRecord(slot)) continue;
      const models = pruneList(slot.models, dead);
      if (!models) continue;
      slot.models = models;
      changed = true;
    }
    if (changed) await db.run(`UPDATE settings SET data = ? WHERE userId = ?`, [stringifyJson({ ...settings, capacityAdapter: adapter }), tenant]);
  }
}
