import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

let providerNameCache: Record<string, string | { name?: string }> | null = null;
let providerNodesCache: Record<string, string> | null = null;

export async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

export function getProviderName(providerId: string, cache: Record<string, string | { name?: string }> | null): string {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === 'string') {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  const name = providerConfig?.name;
  return (typeof name === 'string' ? name : null) || providerId;
}
