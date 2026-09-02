import type { ConnectionProxyConfig } from "./providerTestTypes";
import { safePublicFetch } from "@/server/security/safeFetch";

// requireSafeDestination guards call sites where the URL is user-controlled
// (e.g. a custom baseUrl typed into a connection form) against SSRF. Callers
// that fetch a fixed, app-owned hostname must NOT pass this — safePublicFetch
// uses a different fetch stack (undici direct) that existing tests mocking
// global fetch cannot intercept.
export async function fetchWithConnectionProxy(url: string, options: RequestInit = {}, effectiveProxy: ConnectionProxyConfig | null = null, requireSafeDestination = false): Promise<Response> {
  if (effectiveProxy?.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, {
      vercelRelayUrl: effectiveProxy.vercelRelayUrl,
    });
  }

  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return requireSafeDestination ? safePublicFetch(url, options) : fetch(url, options);
  }

  const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}


