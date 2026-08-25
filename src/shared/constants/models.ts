// Import directly from file to avoid pulling in server-side dependencies via index.js
export {
  PROVIDER_MODELS,
  getProviderModels,
  getDefaultModel,
  isValidModel as isValidModelCore,
  findModelName,
  getModelTargetFormat,
  getModelStrip,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  getModelUpstreamId,
  getModelQuotaFamily
} from "@/lib/open-sse/config/providerModels";

import { AI_PROVIDERS, isOpenAICompatibleProvider } from "./providers";
import { PROVIDER_MODELS as MODELS } from "@/lib/open-sse/config/providerModels";

// Providers that accept any model (passthrough)
const PASSTHROUGH_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.passthroughModels)
    .map(([key]) => key)
);

// Wrap isValidModel with passthrough providers
export function isValidModel(aliasOrId: string, modelId: string): boolean {
  if (isOpenAICompatibleProvider(aliasOrId)) return true;
  if (PASSTHROUGH_PROVIDERS.has(aliasOrId)) return true;
  const models = (MODELS as Record<string, readonly { id: string; name: string }[]>)[aliasOrId];
  if (!models) return false;
  return models.some((m: { id: string }) => m.id === modelId);
}

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS = Object.entries(MODELS as Record<string, readonly { id: string; name: string }[]>).flatMap(([alias, models]) =>
  models.map((m: { id: string; name: string }) => ({ provider: alias, model: m.id, name: m.name }))
);

export const getModelKind = (m: Record<string, unknown> | null | undefined, fallback: string | null = null): string | null =>
  (m?.kind as string) || (m?.type as string) || fallback;

// Capacity metadata for UI badges — icon + label + color per capability.
export const CAPACITY_META = {
  vision: { icon: "visibility", label: "Vision", desc: "Supports image input", color: "text-blue-500" },
  // search: temporarily hidden (feature not wired yet)
  reasoning: { icon: "neurology", label: "Reasoning", desc: "Supports reasoning / thinking", color: "text-amber-500" },
} as const;

export type CapacityKey = keyof typeof CAPACITY_META;
