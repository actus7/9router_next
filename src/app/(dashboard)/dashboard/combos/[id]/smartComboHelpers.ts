import {
  DEFAULT_SMART_ROUTING_CONFIG,
  ROUTE_NEEDS,
  ROUTING_TIERS,
  type RouteNeed,
  type RoutingTier,
  type RoutingTierOrDefault,
  type SmartModelProfile,
  type SmartRoutingConfig,
} from "@/shared/llm-catalog";

export interface ComboData {
  id: string;
  name: string;
  kind: string | null;
  models: string[];
  routing: Record<string, unknown> | null;
}

export interface SuggestionPreview {
  profiles: SmartModelProfile[];
  classifierModel: string;
  researchedAt: string;
  /** Chat models the AA snapshot does not cover: their scores are estimates. */
  unmatched: string[];
  totalInventory: number;
  /** Artificial Analysis snapshot provenance; null when the enrichment is off or failed. */
  aaMeta?: { fetchedAt: string; indexVersion: number | null; matchedCount: number; modelCount: number } | null;
}

export type SuggestionPreset = "balanced" | "performance" | "quality";
export type ModelLatencyMap = Record<string, { latencyMs: number; testedAt: string }>;
export type SuggestionLanes = Record<RoutingTier, SmartModelProfile[]>;

/**
 * NDJSON events streamed by POST /api/smart-routing/suggest: one JSON per
 * line, in this order — two phase markers, then a single terminal `done` or
 * `error`.
 */
export type SuggestProgressEvent =
  | { type: "phase"; phase: "aa-sync" }
  | { type: "phase"; phase: "inventory"; total: number; llmEligible: number }
  | { type: "done"; payload: SuggestionPreview }
  | { type: "error"; message: string };

/** The stream events folded into what the progress modal renders. */
export interface SuggestProgressState {
  phase: "aa-sync" | "inventory";
  inventory: { total: number; llmEligible: number } | null;
}

export const ALL_TIERS: RoutingTierOrDefault[] = ["default", ...ROUTING_TIERS];
export const MAX_SUGGESTIONS_PER_TIER = 10;
// One model offered by several providers: a principal plus one fallback on
// another account, never a lane full of the same model.
export const MAX_COPIES_PER_LANE = 2;
// A provider's credits are shared by all its models, and a 402 locks only the
// model that failed (accountSelection) — so a lane of one provider burns one
// failed call per model before it reaches a fallback. Two per provider, never
// back to back while another provider is available.
export const MAX_PER_PROVIDER_PER_LANE = 2;

/** One need x tier bucket that actually has models pinned in it. */
export interface ActiveScope {
  need: RouteNeed;
  tier: RoutingTierOrDefault;
  count: number;
}

/**
 * The buckets a user has actually filled, so the screen can show the whole
 * configuration at once.
 *
 * The need x tier grid addresses 16 x 5 buckets behind two dropdowns; without
 * this, seeing your own setup means clicking through all 80. `general` is left
 * out because the complexity board renders those tiers directly and the global
 * list covers its default bucket.
 */
export function activeScopesFromConfig(config: SmartRoutingConfig): ActiveScope[] {
  const scopes: ActiveScope[] = [];
  for (const need of ROUTE_NEEDS) {
    if (need === "general") continue;
    const buckets = config.overrides[need];
    if (!buckets) continue;
    for (const tier of ALL_TIERS) {
      const count = buckets[tier]?.length || 0;
      if (count > 0) scopes.push({ need, tier, count });
    }
  }
  return scopes;
}

function latencyForProfile(profile: SmartModelProfile, latencies: ModelLatencyMap): number | null {
  const latency = latencies[profile.modelKey.toLowerCase()]?.latencyMs;
  return typeof latency === "number" ? latency : null;
}

/** The number a lane is ordered by under a preset (performance falls back to Balanced). */
export function laneValue(profile: SmartModelProfile, tier: RoutingTier, preset: SuggestionPreset): number {
  const value = preset === "quality" ? profile.laneQuality?.[tier] : profile.laneScores?.[tier];
  return value ?? 0;
}

function compareForLane(preset: SuggestionPreset, latencies: ModelLatencyMap, tier: RoutingTier) {
  return (a: SmartModelProfile, b: SmartModelProfile) => {
    if (preset === "performance") {
      const aLatency = latencyForProfile(a, latencies);
      const bLatency = latencyForProfile(b, latencies);
      if ((aLatency !== null) !== (bLatency !== null)) return aLatency !== null ? -1 : 1;
      if (aLatency !== null && bLatency !== null && aLatency !== bLatency) return aLatency - bLatency;
    }
    const primary = laneValue(b, tier, preset) - laneValue(a, tier, preset);
    if (primary !== 0) return primary;
    // Ties: the other preset's number, then a stable order.
    const secondary = laneValue(b, tier, preset === "quality" ? "balanced" : "quality")
      - laneValue(a, tier, preset === "quality" ? "balanced" : "quality");
    return secondary || a.modelKey.localeCompare(b.modelKey);
  };
}

/**
 * Picks a lane from candidates already in preset order: the best remaining one
 * whose provider differs from the previous pick (the best one at all when no
 * other provider is left), within the per-model and per-provider caps.
 */
function spreadAcrossProviders(sorted: SmartModelProfile[]): SmartModelProfile[] {
  const picked: SmartModelProfile[] = [];
  const copies = new Map<string, number>();
  const perProvider = new Map<string, number>();
  const pool = [...sorted];
  while (picked.length < MAX_SUGGESTIONS_PER_TIER) {
    const allowed = pool.filter((profile) => (
      (copies.get(profile.canonicalKey ?? profile.modelKey) ?? 0) < MAX_COPIES_PER_LANE
      && (perProvider.get(profile.provider) ?? 0) < MAX_PER_PROVIDER_PER_LANE
    ));
    if (allowed.length === 0) break;
    const previous = picked[picked.length - 1]?.provider;
    const next = allowed.find((profile) => profile.provider !== previous) ?? allowed[0];
    picked.push(next);
    pool.splice(pool.indexOf(next), 1);
    const key = next.canonicalKey ?? next.modelKey;
    copies.set(key, (copies.get(key) ?? 0) + 1);
    perProvider.set(next.provider, (perProvider.get(next.provider) ?? 0) + 1);
  }
  return picked;
}

/**
 * The four lanes of a suggestion, from the server's per-lane scores
 * (laneAssignment): every lane a model is eligible for, ordered by the preset,
 * spread across providers (see MAX_PER_PROVIDER_PER_LANE), at most
 * MAX_COPIES_PER_LANE copies of one model and MAX_SUGGESTIONS_PER_TIER entries.
 */
export function suggestionLanes(
  profiles: SmartModelProfile[],
  preset: SuggestionPreset = "balanced",
  latencies: ModelLatencyMap = {},
): SuggestionLanes {
  const lanes = {} as SuggestionLanes;
  for (const tier of ROUTING_TIERS) {
    lanes[tier] = spreadAcrossProviders(
      profiles
        .filter((profile) => typeof profile.laneScores?.[tier] === "number")
        .sort(compareForLane(preset, latencies, tier)),
    );
  }
  return lanes;
}

/**
 * Folds a legacy `overrides.general.default` bucket into the global list.
 *
 * Two editors used to write to the same effective slot: `combo.models` (which
 * the router merges into the default bucket of both the classified and the
 * endpoint need) and the need x tier grid with need=general, whose only tier
 * option was `default`. The grid lost that combination, so a config saved by
 * the old screen would keep models the UI no longer shows.
 *
 * Moving them to `combo.models` only widens where they apply — the general
 * bucket is a subset of what the legacy merge already covers — so nothing a
 * user configured stops taking effect.
 */
export function foldGeneralDefaultIntoGlobals(
  config: SmartRoutingConfig,
  models: string[],
): { config: SmartRoutingConfig; models: string[] } {
  const stranded = config.overrides.general?.default || [];
  if (stranded.length === 0) return { config, models };

  const general = { ...config.overrides.general };
  delete general.default;

  return {
    config: { ...config, overrides: { ...config.overrides, general } },
    models: [...new Set([...models, ...stranded])],
  };
}

export function normalizeConfig(value: Record<string, unknown> | null): SmartRoutingConfig {
  const input = value || {};
  const complexity = input.complexity as Partial<SmartRoutingConfig["complexity"]> | undefined;
  const task = input.task as Partial<SmartRoutingConfig["task"]> | undefined;
  const classifier = input.classifier as Partial<SmartRoutingConfig["classifier"]> | undefined;
  return {
    ...DEFAULT_SMART_ROUTING_CONFIG,
    complexity: { ...DEFAULT_SMART_ROUTING_CONFIG.complexity, ...complexity },
    task: { ...DEFAULT_SMART_ROUTING_CONFIG.task, ...task },
    classifier: { ...DEFAULT_SMART_ROUTING_CONFIG.classifier, ...classifier },
    overrides: (input.overrides as SmartRoutingConfig["overrides"] | undefined) || {},
  };
}
