import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Header sent by fetchCompatibleModelIds to detect cross-instance /models fetches
// and break recursive loops between modelhub instances connected to each other.
export const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";

// LLM kind sentinel — combos/models with no explicit kind default to LLM
export const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
export const MODEL_TYPE_TO_KIND: Record<string, string> = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
  video: "video",
};

export function modelKind(model: Record<string, unknown>) {
  const k = (model?.kind || model?.type) as string | undefined;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] || LLM_KIND;
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
export function inferKindFromUnknownModelId(modelId: string) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

// Provider matches kindFilter when its serviceKinds intersect the requested kinds.
// LLM is the default kind for providers missing serviceKinds.
export function providerMatchesKinds(providerId: string, kindFilter: string[]) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
export function comboMatchesKinds(combo: Record<string, unknown>, kindFilter: string[]) {
  const kind = (combo?.kind || LLM_KIND) as string;
  if (kind === "smart") return true;
  return kindFilter.includes(kind);
}

export interface ModelsData {
  connections: import("./liveModelResolvers").ConnectionRecord[];
  combos: Record<string, unknown>[];
  customModels: Record<string, unknown>[];
  modelAliases: Record<string, unknown>;
  disabledByAlias: Record<string, string[]>;
}

export interface ProviderContext {
  providerId: string;
  outputAlias: string;
  staticAlias: string;
  rawModelIds: string[];
  staticModelKindById: Map<string, string>;
  liveModelKindById: Map<string, string>;
  liveCapabilitiesById: Map<string, Record<string, unknown>>;
}

export { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS };
