import { AI_PROVIDERS } from "../shared/constants/providers";

interface ProviderEntry {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 */
export function isXaiModel(modelId: string): boolean {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider: string): string {
  if (typeof provider !== "string") return provider;

  const trimmed: string = provider.trim();
  if ((AI_PROVIDERS as Record<string, ProviderEntry>)[trimmed]) return trimmed;

  const slug: string = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if ((AI_PROVIDERS as Record<string, ProviderEntry>)[slug]) return slug;

  const providerByName: ProviderEntry | undefined = Object.values(AI_PROVIDERS as Record<string, ProviderEntry>).find(
    (entry: ProviderEntry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return providerByName?.id || trimmed;
}

export function normalizeProviderSpecificData(
  provider: string,
  body: Record<string, unknown> = {},
  providerSpecificData: Record<string, unknown> | null = null
): Record<string, unknown> | null {
  const next: Record<string, unknown> = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  if (provider === "ollama-local") {
    const baseUrl: string = (
      (next.baseUrl as string) ||
      (body.baseUrl as string) ||
      (body.baseURL as string) ||
      (body.ollamaHostUrl as string) ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  return Object.keys(next).length > 0 ? next : null;
}
