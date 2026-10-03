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
  researchProvider: string | null;
  webResearchUsed: boolean;
  truncated: boolean;
  /** Artificial Analysis snapshot provenance; null when the enrichment is off or failed. */
  aaMeta?: { fetchedAt: string; indexVersion: number | null; matchedCount: number; modelCount: number } | null;
}

export type SuggestionPreset = "balanced" | "performance" | "quality";
export type ModelLatencyMap = Record<string, { latencyMs: number; testedAt: string }>;

/**
 * NDJSON events streamed by POST /api/smart-routing/suggest: one JSON per
 * line, in this order — phase markers, the cache report, one event per batch,
 * then a single terminal `done` (today's response body) or `error`.
 */
export type SuggestProgressEvent =
  | { type: "phase"; phase: "aa-sync" }
  | { type: "phase"; phase: "inventory"; total: number; llmEligible: number }
  | { type: "cache"; cached: number; toAnalyze: number; skippedByLimit: number }
  | { type: "phase"; phase: "web-research"; used: boolean }
  | { type: "batch"; index: number; total: number; analyzed: string[] }
  | { type: "done"; payload: SuggestionPreview }
  | { type: "error"; message: string };

/** The stream events folded into what the progress modal renders. */
export interface SuggestProgressState {
  /** Latest phase that started; `batch` while batches stream in. */
  phase: "aa-sync" | "inventory" | "cache" | "web-research" | "batch";
  inventory: { total: number; llmEligible: number } | null;
  cache: { cached: number; toAnalyze: number; skippedByLimit: number } | null;
  webResearchUsed: boolean | null;
  batch: { index: number; total: number } | null;
  /** Models analyzed in this run, most recent batch first. */
  analyzed: string[];
}

export const ALL_TIERS: RoutingTierOrDefault[] = ["default", ...ROUTING_TIERS];
export const MAX_SUGGESTIONS_PER_TIER = 10;

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

function compareProfiles(preset: SuggestionPreset, latencies: ModelLatencyMap, tier?: RoutingTier) {
  return (a: SmartModelProfile, b: SmartModelProfile) => {
    if (preset === "performance") {
      const aLatency = latencyForProfile(a, latencies);
      const bLatency = latencyForProfile(b, latencies);
      const aTested = aLatency !== null;
      const bTested = bLatency !== null;
      if (aTested !== bTested) return aTested ? -1 : 1;
      if (aLatency !== null && bLatency !== null && aLatency !== bLatency) return aLatency - bLatency;
      if (a.latencyScore !== b.latencyScore) return b.latencyScore - a.latencyScore;
    }
    // The AA per-tier score is `quality` measured instead of guessed: when both
    // profiles carry it, it decides the column order before the heuristics do.
    const aAaScore = tier ? a.aaScores?.[tier] : undefined;
    const bAaScore = tier ? b.aaScores?.[tier] : undefined;
    if (typeof aAaScore === "number" && typeof bAaScore === "number" && aAaScore !== bAaScore) return bAaScore - aAaScore;
    if (a.quality !== b.quality) return b.quality - a.quality;
    if (a.reliabilityScore !== b.reliabilityScore) return b.reliabilityScore - a.reliabilityScore;
    return a.modelKey.localeCompare(b.modelKey);
  };
}

export function capProfilesPerTier(
  profiles: SmartModelProfile[],
  preset: SuggestionPreset = "balanced",
  latencies: ModelLatencyMap = {},
): SmartModelProfile[] {
  // An LLM classifier can legitimately omit a tier when it considers two
  // neighboring tiers similar. The routing board, however, promises four
  // usable lanes. Rebalance only surplus profiles so a single bad classifier
  // response never leaves a lane (notably "complex") empty.
  const rebalanced = profiles.map((profile) => ({ ...profile }));
  const targetQuality: Record<RoutingTierOrDefault, number> = {
    default: 0.65,
    simple: 0.45,
    standard: 0.65,
    complex: 0.8,
    reasoning: 0.92,
  };

  for (const tier of ROUTING_TIERS) {
    if (rebalanced.some((profile) => profile.recommendedTier === tier)) continue;
    const counts = new Map(ROUTING_TIERS.map((candidate) => [
      candidate,
      rebalanced.filter((profile) => profile.recommendedTier === candidate).length,
    ]));
    const replacement = rebalanced
      .filter((profile) => (counts.get(profile.recommendedTier) || 0) > 1)
      .sort((a, b) => (
        Math.abs(a.quality - targetQuality[tier]) - Math.abs(b.quality - targetQuality[tier])
        || compareProfiles(preset, latencies, tier)(a, b)
      ))[0];
    if (replacement) replacement.recommendedTier = tier;
  }

  return ROUTING_TIERS.flatMap((tier) =>
    rebalanced
      .filter((profile) => profile.recommendedTier === tier)
      .sort(compareProfiles(preset, latencies, tier))
      .slice(0, MAX_SUGGESTIONS_PER_TIER),
  );
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
