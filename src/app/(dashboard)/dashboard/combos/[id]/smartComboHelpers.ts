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

export const ALL_TIERS: RoutingTierOrDefault[] = ["default", ...ROUTING_TIERS];
export const MAX_SUGGESTIONS_PER_TIER = 10;

export function capProfilesPerTier(profiles: SmartModelProfile[]): SmartModelProfile[] {
  return ROUTING_TIERS.flatMap((tier) =>
    profiles
      .filter((profile) => profile.recommendedTier === tier)
      .sort((a, b) => b.quality - a.quality)
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
