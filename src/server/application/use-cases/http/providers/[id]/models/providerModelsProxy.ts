import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

export async function fetchWithConnectionProxy(
  url: string,
  options: RequestInit,
  providerSpecificData: Record<string, unknown> | null | undefined,
): Promise<Response> {
  const proxy = (await resolveConnectionProxyConfig(providerSpecificData || {})) || {};
  if (proxy.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, { vercelRelayUrl: proxy.vercelRelayUrl });
  }
  if (proxy.connectionProxyEnabled && proxy.connectionProxyUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, {
      connectionProxyEnabled: true,
      connectionProxyUrl: proxy.connectionProxyUrl,
      connectionNoProxy: proxy.connectionNoProxy || "",
    });
  }
  return fetch(url, options);
}
