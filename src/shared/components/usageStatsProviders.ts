"use client";

import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

function isLLMProvider(id: string): boolean {
  const p = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
  if (!p?.serviceKinds) return true;
  return (p.serviceKinds as string[]).includes("llm");
}

export async function fetchConnectedProviders(): Promise<{ provider: string; name: string; nodeName?: string }[]> {
  const [d, nodesData] = await Promise.all([
    fetch("/api/providers").then((r) => r.ok ? r.json() : null),
    fetch("/api/provider-nodes").then((r) => r.ok ? r.json() : null),
  ]);
  const nodeNameMap: Record<string, string> = {};
  for (const node of (nodesData?.nodes || [])) nodeNameMap[node.id] = node.name;
  const seen = new Set<string>();
  const unique = (d?.connections || []).filter((c: { isActive?: boolean; provider: string }) => {
    if (c.isActive === false) return false;
    if (!isLLMProvider(c.provider)) return false;
    if (seen.has(c.provider)) return false;
    seen.add(c.provider);
    return true;
  }).map((c: { provider: string; name?: string }) => ({ ...c, nodeName: nodeNameMap[c.provider] || undefined }));
  const noAuth = Object.values(FREE_PROVIDERS as Record<string, { id: string; name: string; noAuth?: boolean; hidden?: boolean }>)
    .filter((p) => p.noAuth && !p.hidden && !seen.has(p.id) && isLLMProvider(p.id))
    .map((p) => ({ provider: p.id, name: p.name }));
  return [...unique, ...noAuth];
}
