import "server-only";

import { safePublicFetch, type DestinationPolicy } from "@/server/security/safeFetch";
import { privateProviderEndpointsAllowed } from "@/server/security/providerEndpoint";
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

/**
 * Whether validation may reach a loopback or private address.
 *
 * The four provider families below used to get `"trusted-local"` unconditionally,
 * which turned the validate endpoint into a blind SSRF probe — an account picks
 * the URL, and the status code says what is listening inside the network. They
 * still need it on a self-hosted box (Ollama on 127.0.0.1), so the exception is
 * now the same deployment-level switch the inference path uses rather than a
 * property of the provider id.
 */
export function resolveProviderValidateFetchPolicy(
  url: string,
  options: { providerId?: string; allowLocal?: boolean } = {},
): DestinationPolicy {
  if (options.allowLocal) return "trusted-local";
  if (!privateProviderEndpointsAllowed()) return "public-only";

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
