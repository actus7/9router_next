"use client";

import type { Connection, ProviderNode, ProxyPool } from "../types";

export async function fetchAllProviderData(
  providerId: string,
  isCompatible: boolean,
  setConnections: (c: Connection[]) => void,
  setProxyPools: (p: ProxyPool[]) => void,
  setProviderNode: (n: ProviderNode | null) => void,
  loadSettings: (s: Record<string, unknown>) => void,
) {
  try {
    const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/provider-nodes", { cache: "no-store" }),
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" }),
    ]);
    const connectionsData = await connectionsRes.json();
    const nodesData = await nodesRes.json();
    const proxyPoolsData = await proxyPoolsRes.json();
    const settingsData = settingsRes.ok ? await settingsRes.json() : {};
    if (connectionsRes.ok) setConnections((connectionsData.connections || []).filter((c: Connection) => c.provider === providerId));
    if (proxyPoolsRes.ok) setProxyPools(proxyPoolsData.proxyPools || []);
    loadSettings(settingsData);
    if (nodesRes.ok) {
      let node = (nodesData.nodes || []).find((entry: ProviderNode) => entry.id === providerId) || null;
      if (!node && isCompatible) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
          if (!retryRes.ok) continue;
          const retryData = await retryRes.json();
          node = (retryData.nodes || []).find((entry: ProviderNode) => entry.id === providerId) || null;
          if (node) break;
        }
      }
      setProviderNode(node);
    }
  } catch (error) { console.error("Error fetching connections:", error); }
}
