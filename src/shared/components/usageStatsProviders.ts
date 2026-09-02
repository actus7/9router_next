"use client";

import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

function isLLMProvider(id: string): boolean {
  const p = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
  if (!p?.serviceKinds) return true;
  return (p.serviceKinds as string[]).includes("llm");
}

export function buildConnectedProviders(
  d: { connections?: { isActive?: boolean; provider: string; name?: string }[] } | null | undefined,
  nodesData: { nodes?: { id: string; name: string }[] } | null | undefined,
): { provider: string; name: string; nodeName?: string }[] {
  const nodeNameMap: Record<string, string> = {};
  for (const node of (nodesData?.nodes || [])) nodeNameMap[node.id] = node.name;
  const seen = new Set<string>();
  const unique = (d?.connections || []).filter((c: { isActive?: boolean; provider: string }) => {
    if (c.isActive === false) return false;
    if (!isLLMProvider(c.provider)) return false;
    if (seen.has(c.provider)) return false;
    seen.add(c.provider);
    return true;
  }).map((c: { provider: string; name?: string }) => ({ provider: c.provider, name: c.name || c.provider, nodeName: nodeNameMap[c.provider] || undefined }));
  const noAuth = Object.values(FREE_PROVIDERS as Record<string, { id: string; name: string; noAuth?: boolean; hidden?: boolean }>)
    .filter((p) => p.noAuth && !p.hidden && !seen.has(p.id) && isLLMProvider(p.id))
    .map((p) => ({ provider: p.id, name: p.name }));
  return [...unique, ...noAuth];
}
