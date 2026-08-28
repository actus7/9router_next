// Public server API of the LLM gateway â€” model/provider catalog & pricing.
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
} from "@/lib/open-sse/config/providerModels";

// Capabilities
export {
  getCapabilitiesForModel,
  capabilitiesFromServiceKind,
} from "@/lib/open-sse/providers/capabilities";

// Pricing
export {
  getDefaultPricing,
  getPricingForModel,
  calculateCostFromTokens,
  PROVIDER_PRICING,
  MODEL_PRICING,
} from "@/lib/open-sse/providers/pricing";

// Provider config helpers
export {
  PROVIDERS,
  resolveOllamaLocalHost,
  resolveXiaomiTokenplanBaseUrl,
} from "@/lib/open-sse/config/providers";

// Ollama static tags
export { ollamaModels } from "@/lib/open-sse/config/ollamaModels";

// Live model resolvers (fetch from provider APIs with credentials)
export { resolveKiroModels } from "@/lib/open-sse/services/kiroModels";
export { resolveKimchiModels } from "@/lib/open-sse/services/kimchiModels";
export { resolveQoderModels, resolveQoderCredentials } from "@/lib/open-sse/services/qoderModels";
export { resolveGrokCliModels } from "@/lib/open-sse/services/grokCliModels";
export { resolveCursorModels } from "@/lib/open-sse/services/cursorModels";
export { resolveCopilotModels } from "@/lib/open-sse/services/copilotModels";
export { resolveClinepassModels } from "@/lib/open-sse/services/clinepassModels";
export { resolveZedModels } from "@/lib/open-sse/shared/zedAuth";

// Combo rotation state (server singleton)
export { resetComboRotation } from "@/lib/open-sse/services/combo";
