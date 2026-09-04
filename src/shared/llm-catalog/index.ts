// Client-safe LLM catalog surface: pure types/metadata shared by server and
// client components. MUST NOT import node:*, database, secrets, executors,
// OAuth services or `server-only` — anything server-side belongs behind
// @/server/llm-gateway/*.
//
// Re-export point only: the engine still lives at @/server/llm-gateway/engine until the
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
} from "@/server/llm-gateway/engine/config/providerModels";

// Model capabilities (pure pattern matching, no I/O)
export {
  DEFAULT_CAPABILITIES,
  MODEL_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  getCapabilitiesForModel,
  capabilitiesFromServiceKind,
} from "@/server/llm-gateway/engine/providers/capabilities";

// Provider registry display metadata (pure data definitions)
export { default as REGISTRY } from "@/server/llm-gateway/engine/providers/registry/index";
export { MEDIA_ENTRY_KEYS } from "@/server/llm-gateway/engine/providers/mediaKeys";
export type { RegistryEntry } from "@/server/llm-gateway/engine/providers/schema";

// Thinking levels (pure lookup)
export { getThinkingLevels } from "@/server/llm-gateway/engine/providers/thinkingLevels";

// TTS catalog (pure data)
export { getTtsVoicesForModel } from "@/server/llm-gateway/engine/config/ttsModels";
export { GOOGLE_TTS_LANGUAGES } from "@/server/llm-gateway/engine/config/googleTtsLanguages";

// Smart routing contract (types + pure defaults)
export {
  ROUTING_TIERS,
  ROUTE_NEEDS,
  DEFAULT_SMART_ROUTING_CONFIG,
} from "@/server/llm-gateway/engine/services/smart-routing/types";
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
} from "@/server/llm-gateway/engine/services/smart-routing/types";
