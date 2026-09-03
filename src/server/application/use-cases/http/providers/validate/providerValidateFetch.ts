import "server-only";

import { safePublicFetch, type DestinationPolicy } from "@/server/security/safeFetch";
import {
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized.endsWith(".local");
}

/** User-configured or self-hosted endpoints may target loopback/private networks. */
export function resolveProviderValidateFetchPolicy(
  url: string,
  options: { providerId?: string; allowLocal?: boolean } = {},
): DestinationPolicy {
  if (options.allowLocal) return "trusted-local";
  if (options.providerId) {
    if (
      options.providerId === "ollama"
      || isOpenAICompatibleProvider(options.providerId)
      || isAnthropicCompatibleProvider(options.providerId)
      || isCustomEmbeddingProvider(options.providerId)
    ) {
      return "trusted-local";
    }
  }

  try {
    const parsed = new URL(url);
    if (isLocalHostname(parsed.hostname)) return "trusted-local";
  } catch {
    return "public-only";
  }

  return "public-only";
}

export async function providerValidateFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  options: { providerId?: string; allowLocal?: boolean } = {},
): Promise<Response> {
  const policy = resolveProviderValidateFetchPolicy(url, options);
  return safePublicFetch(url, { ...init, destinationPolicy: policy });
}
