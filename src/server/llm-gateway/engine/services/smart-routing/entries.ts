import type { EntryConfig } from "../../host/entryConfig";
import type { RankedSmartCandidate } from "./inventory";
import type { LaneEntryConfig, RouteNeed, RoutingTier, SmartRoutingConfig } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** A stored entry config, or null when it carries nothing usable (a malformed one never fails a read). */
export function parseLaneEntry(raw: unknown): LaneEntryConfig | null {
  if (!isRecord(raw)) return null;
  const connectionId = typeof raw.connectionId === "string" && raw.connectionId.trim() ? raw.connectionId.trim() : undefined;
  const params = isRecord(raw.params) && Object.keys(raw.params).length > 0 && Object.values(raw.params).every(isPrimitive)
    ? (raw.params as LaneEntryConfig["params"])
    : undefined;
  return connectionId || params ? { ...(connectionId ? { connectionId } : {}), ...(params ? { params } : {}) } : null;
}

/**
 * One lane's model keys with their configs, index-aligned. The same model may
 * appear once per account; an exact repeat (same model, same account) is
 * collapsed with its config.
 */
export function normalizeLane(list: unknown[], rawEntries: unknown): { models: string[]; entries: Array<LaneEntryConfig | null> } {
  const models: string[] = [];
  const entries: Array<LaneEntryConfig | null> = [];
  const seen = new Set<string>();
  list.forEach((model, index) => {
    if (typeof model !== "string" || !model.includes("/")) return;
    const entry = parseLaneEntry(Array.isArray(rawEntries) ? rawEntries[index] : null);
    const key = `${model}|${entry?.connectionId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    models.push(model);
    entries.push(entry);
  });
  return { models, entries };
}

function laneOf(config: SmartRoutingConfig, need: RouteNeed, tier: RoutingTier): { models: string[]; entries?: Array<LaneEntryConfig | null> } | null {
  const source: RouteNeed = config.overrides[need]?.[tier] !== undefined ? need : "general";
  const models = config.overrides[source]?.[tier];
  return models ? { models, entries: config.entries?.[source]?.[tier] } : null;
}

/**
 * The ranking yields one candidate per model; a model listed once per account
 * becomes one candidate per entry here, in lane order, and each entry's config
 * is handed to the combo (see `entryConfigs` there). The lane is looked up the
 * way the ranking does it: the need's own column, else `general`.
 */
export function expandEntryCandidates(
  ranked: RankedSmartCandidate[],
  config: SmartRoutingConfig,
  need: RouteNeed,
): { candidates: RankedSmartCandidate[]; entryConfigs: Map<string, Array<EntryConfig | undefined>> } {
  const candidates: RankedSmartCandidate[] = [];
  const entryConfigs = new Map<string, Array<EntryConfig | undefined>>();
  for (const candidate of ranked) {
    const lane = candidate.column ? laneOf(config, need, candidate.tier) : null;
    const positions = lane ? lane.models.flatMap((model, index) => (model === candidate.modelKey ? [index] : [])) : [];
    const configs = positions.map((index) => lane?.entries?.[index] ?? undefined);
    const nothingToHand = configs.every((entry) => entry === undefined);
    if (positions.length === 0 || (nothingToHand && positions.length === 1)) {
      candidates.push(candidate);
      continue;
    }
    entryConfigs.set(candidate.modelKey, configs);
    for (let copy = 0; copy < positions.length; copy += 1) candidates.push({ ...candidate });
  }
  return { candidates, entryConfigs };
}
