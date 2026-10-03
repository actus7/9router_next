export const ROUTING_TIERS = ["simple", "standard", "complex", "reasoning"] as const;
export type RoutingTier = (typeof ROUTING_TIERS)[number];
export type RoutingTierOrDefault = RoutingTier | "default";

export const ROUTE_NEEDS = [
  "general",
  "vision",
  "tool_use",
  "coding",
  "data_analysis",
  "web_search",
  "web_fetch",
  "image_generation",
  "video_generation",
  "tts",
  "stt",
  "embeddings",
  "email_management",
  "calendar_management",
  "social_media",
  "trading",
] as const;
export type RouteNeed = (typeof ROUTE_NEEDS)[number];

interface SmartRoutingClassifierConfig {
  enabled: boolean;
  confidenceThreshold: number;
  timeoutMs: number;
  model: "auto" | string;
}

export interface SmartRoutingConfig {
  version: 1;
  complexity: {
    enabled: boolean;
  };
  task: {
    enabled: boolean;
    confidenceThreshold: number;
  };
  classifier: SmartRoutingClassifierConfig;
  overrides: Partial<Record<RouteNeed, Partial<Record<RoutingTierOrDefault, string[]>>>>;
}

/**
 * Aggregated benchmark/pricing metrics published by Artificial Analysis for one
 * model. Numbers arrive from a third-party table: every field is nullable
 * because the API omits what it has not measured — callers treat null as
 * "unknown", never as zero.
 */
export interface AaModelMetrics {
  aaId: string;
  slug: string;
  name: string;
  creator: string | null;
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
  math: number | null;
  inputUsdPer1M: number | null;
  outputUsdPer1M: number | null;
  outputTokensPerSecond: number | null;
  ttftSeconds: number | null;
  benchmarkCostUsd: number | null;
}

/** Provenance of an AA snapshot: what was fetched, when, and how much matched. */
export interface AaSnapshotMeta {
  fetchedAt: string;
  indexVersion: number | null;
  tier: string | null;
  modelCount: number;
  matchedCount?: number;
}

export interface SmartModelCapabilities {
  serviceKinds: string[];
  vision: boolean;
  pdf: boolean;
  audioInput: boolean;
  videoInput: boolean;
  imageOutput: boolean;
  audioOutput: boolean;
  tools: boolean;
  search: boolean;
  reasoning: boolean;
  contextWindow: number;
  maxOutput: number;
}

export interface SmartModelProfile {
  modelKey: string;
  provider: string;
  model: string;
  displayName: string;
  capabilities: SmartModelCapabilities;
  inputPrice: number | null;
  outputPrice: number | null;
  quality: number;
  latencyScore: number;
  reliabilityScore: number;
  recommendedTier: RoutingTier;
  needScores: Partial<Record<RouteNeed, number>>;
  source: "deterministic" | "llm" | "manual";
  inventoryFingerprint: string;
  classifierModel?: string | null;
  sources?: string[];
  researchedAt?: string | null;
  updatedAt?: string;
  /** Artificial Analysis metrics, present only when the model matched the AA snapshot. */
  aa?: AaModelMetrics;
  /**
   * Suggestion board (see laneAssignment): the lanes this model is eligible
   * for, scored 0..1 under the Balanced weights. A model can hold several.
   */
  laneScores?: Partial<Record<RoutingTier, number>>;
  /** Same lanes, quality alone — what "Highest quality" orders by. */
  laneQuality?: Partial<Record<RoutingTier, number>>;
  /** Whether the lane scores come from AA measurements or are an estimate. */
  scoreSource?: "measured" | "estimated";
  /** One key for this model across providers (see modelIdentity). */
  canonicalKey?: string;
  /** Compact reason line for the suggestion board; only with `aa`. */
  suggestionReason?: string;
}

export type RoutingReason =
  | "header_override"
  | "short_message"
  | "formal_logic_override"
  | "tool_detected"
  | "large_context"
  | "specificity"
  | "scored"
  | "momentum"
  | "llm_classifier"
  | "jev_classifier"
  | "jev_primary"
  | "ambiguous"
  | "endpoint"
  | "default";

/** Which classifier produced the decided tier/need (or the values that stood). */
export type ClassifierSource = "jev" | "heuristic" | "llm";

export interface RoutingDecisionMeta {
  comboName: string;
  need: RouteNeed;
  tier: RoutingTierOrDefault;
  score: number;
  confidence: number;
  reason: RoutingReason;
  degraded: boolean;
  tierOrder: RoutingTier[];
  candidates: string[];
  candidateDetails: Array<{ model: string; tier: RoutingTier; degraded: boolean; source: "manual" | "llm" | "deterministic" }>;
  selectedModel?: string;
  classifierModel?: string;
  classifierLatencyMs?: number;
  classifierSource?: ClassifierSource;
  profileSources: Array<"manual" | "llm" | "deterministic">;
}

export interface SmartComboEntry {
  id?: string;
  name: string;
  kind?: string | null;
  models: string[];
  routing?: SmartRoutingConfig | null;
}

export const DEFAULT_SMART_ROUTING_CONFIG: SmartRoutingConfig = {
  version: 1,
  complexity: { enabled: true },
  task: { enabled: true, confidenceThreshold: 0.4 },
  classifier: {
    enabled: true,
    confidenceThreshold: 0.45,
    timeoutMs: 5_000,
    model: "auto",
  },
  overrides: {},
};
