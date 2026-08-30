// Public server API of the LLM gateway — model/provider catalog & pricing.
import "server-only";

// Static model matrix
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
  getModelTargetFormat,
  getModelSupportedFormats,
  getModelUpstreamId,
  getModelQuotaFamily,
  getModelStrip,
} from "@/server/llm-gateway/engine/config/providerModels";

// Capabilities
export {
  getCapabilitiesForModel,
  capabilitiesFromServiceKind,
} from "@/server/llm-gateway/engine/providers/capabilities";

// Pricing
export {
  getDefaultPricing,
  getPricingForModel,
  calculateCostFromTokens,
  PROVIDER_PRICING,
  MODEL_PRICING,
} from "@/server/llm-gateway/engine/providers/pricing";

// Provider config helpers
export {
  PROVIDERS,
  resolveXiaomiTokenplanBaseUrl,
} from "@/server/llm-gateway/engine/config/providers";

// Ollama static tags
export { ollamaModels } from "@/server/llm-gateway/engine/config/ollamaModels";

// Live model resolvers (fetch from provider APIs with credentials)
export { resolveKiroModels } from "@/server/llm-gateway/engine/services/kiroModels";
export { resolveKimchiModels } from "@/server/llm-gateway/engine/services/kimchiModels";
export { resolveQoderModels, resolveQoderCredentials } from "@/server/llm-gateway/engine/services/qoderModels";
export { resolveGrokCliModels } from "@/server/llm-gateway/engine/services/grokCliModels";
export { resolveCursorModels } from "@/server/llm-gateway/engine/services/cursorModels";
export { resolveCopilotModels } from "@/server/llm-gateway/engine/services/copilotModels";
export { resolveClinepassModels } from "@/server/llm-gateway/engine/services/clinepassModels";
export { resolveZedModels } from "@/server/llm-gateway/engine/shared/zedAuth";

// Combo rotation state (server singleton)
export { resetComboRotation } from "@/server/llm-gateway/engine/services/combo";
