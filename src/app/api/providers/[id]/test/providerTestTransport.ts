import type { ConnectionProxyConfig } from "./providerTestTypes";

export async function fetchWithConnectionProxy(url: string, options: RequestInit = {}, effectiveProxy: ConnectionProxyConfig | null = null): Promise<Response> {
  if (effectiveProxy?.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, {
      vercelRelayUrl: effectiveProxy.vercelRelayUrl,
    });
  }

  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return fetch(url, options);
  }

  const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}


