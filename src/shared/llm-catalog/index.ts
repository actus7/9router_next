// Client-safe LLM catalog surface: pure types/metadata shared by server and
// client components. MUST NOT import node:*, database, secrets, executors,
// OAuth services or `server-only` — anything server-side belongs behind
// @/server/llm-gateway/*.
//
// Re-export point only: the engine still lives at @/lib/open-sse until the
// Phase 3 rename; after that this barrel follows the move.

// Static model catalog (alias -> models matrix)
export {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
  OAUTH_ALIASES,
  getProviderModels,
  getDefaultModel,
  isValidModel,
  findModelName,
  getModelType,
  getModelsByProviderId,
} from "@/lib/open-sse/config/providerModels";

// Model capabilities (pure pattern matching, no I/O)
export {
  DEFAULT_CAPABILITIES,
  MODEL_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  getCapabilitiesForModel,
  capabilitiesFromServiceKind,
} from "@/lib/open-sse/providers/capabilities";

// Provider registry display metadata (pure data definitions)
export { default as REGISTRY } from "@/lib/open-sse/providers/registry/index";

// Thinking levels (pure lookup)
export { getThinkingLevels } from "@/lib/open-sse/providers/thinkingLevels";

// TTS catalog (pure data)
export { getTtsVoicesForModel } from "@/lib/open-sse/config/ttsModels";
export { GOOGLE_TTS_LANGUAGES } from "@/lib/open-sse/config/googleTtsLanguages";

// Smart routing contract (types + pure defaults)
export {
  ROUTING_TIERS,
  ROUTE_NEEDS,
  DEFAULT_SMART_ROUTING_CONFIG,
} from "@/lib/open-sse/services/smart-routing/types";
export type {
  RoutingTier,
  RoutingTierOrDefault,
  RouteNeed,
  SmartRoutingClassifierConfig,
  SmartRoutingConfig,
  SmartModelCapabilities,
  SmartModelProfile,
  RoutingReason,
  RoutingDecisionMeta,
  SmartComboEntry,
} from "@/lib/open-sse/services/smart-routing/types";
