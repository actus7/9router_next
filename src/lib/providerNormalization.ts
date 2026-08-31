import { AI_PROVIDERS, resolveProviderId } from "../shared/constants/providers";

interface ProviderEntry {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 */
function isXaiModel(modelId: string): boolean {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider: string): string {
  if (typeof provider !== "string") return provider;

  const trimmed: string = provider.trim();
  if ((AI_PROVIDERS as Record<string, ProviderEntry>)[trimmed]) return trimmed;

  // Provider forms use the public routing alias (for example `naga`), while
  // persisted connections must use the registry ID (`naga-ac`). Resolve that
  // alias before applying the legacy slug/name fallbacks.
  const aliasId = resolveProviderId(trimmed);
  if ((AI_PROVIDERS as Record<string, ProviderEntry>)[aliasId]) return aliasId;

  // Display names are accepted only when unique. Some providers intentionally
  // share a name (such as two GitHub Copilot integrations), so silently
  // choosing the first entry would persist credentials for the wrong service.
  const nameMatches = Object.values(AI_PROVIDERS as Record<string, ProviderEntry>).filter(
    (entry: ProviderEntry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return nameMatches.length === 1 ? nameMatches[0].id : trimmed;
}

export function normalizeProviderSpecificData(
  _provider: string,
  _body: Record<string, unknown> = {},
  providerSpecificData: Record<string, unknown> | null = null
): Record<string, unknown> | null {
  const next: Record<string, unknown> = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  return Object.keys(next).length > 0 ? next : null;
}
