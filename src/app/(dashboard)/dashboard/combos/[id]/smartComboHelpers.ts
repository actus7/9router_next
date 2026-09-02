import {
  DEFAULT_SMART_ROUTING_CONFIG,
  ROUTING_TIERS,
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
}

export type SuggestionPreset = "balanced" | "performance" | "quality";
export type ModelLatencyMap = Record<string, { latencyMs: number; testedAt: string }>;

export const ALL_TIERS: RoutingTierOrDefault[] = ["default", ...ROUTING_TIERS];
export const MAX_SUGGESTIONS_PER_TIER = 10;

function latencyForProfile(profile: SmartModelProfile, latencies: ModelLatencyMap): number | null {
  const latency = latencies[profile.modelKey.toLowerCase()]?.latencyMs;
  return typeof latency === "number" ? latency : null;
}

function compareProfiles(preset: SuggestionPreset, latencies: ModelLatencyMap) {
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
        || compareProfiles(preset, latencies)(a, b)
      ))[0];
    if (replacement) replacement.recommendedTier = tier;
  }

  return ROUTING_TIERS.flatMap((tier) =>
    rebalanced
      .filter((profile) => profile.recommendedTier === tier)
      .sort(compareProfiles(preset, latencies))
      .slice(0, MAX_SUGGESTIONS_PER_TIER),
  );
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
