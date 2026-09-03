import {
  AI_PROVIDERS,
  MEDIA_PROVIDER_KINDS,
  isCustomEmbeddingProvider,
  type ProviderCatalogEntry,
} from "@/shared/constants/providers";

export function isValidMediaProviderKind(kind: string): boolean {
  return MEDIA_PROVIDER_KINDS.some((entry) => entry.id === kind);
}

function getMediaProviderServiceKinds(provider: ProviderCatalogEntry): string[] {
  return provider.serviceKinds ?? ["llm"];
}

export function isCustomEmbeddingDetail(kind: string, id: string): boolean {
  return kind === "embedding" && isCustomEmbeddingProvider(id);
}

export function isValidBuiltInMediaProviderDetail(kind: string, id: string): boolean {
  const provider = AI_PROVIDERS[id];
  if (!provider) return false;
  return getMediaProviderServiceKinds(provider).includes(kind);
}
