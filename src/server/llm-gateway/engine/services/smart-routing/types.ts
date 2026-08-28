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

export interface SmartRoutingClassifierConfig {
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
  | "ambiguous"
  | "endpoint"
  | "default";

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
