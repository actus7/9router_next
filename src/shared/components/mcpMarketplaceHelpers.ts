"use client";

import type { McpServer } from "./useMcpMarketplace";

export function filterServers(servers: McpServer[], search: string, filter: string): McpServer[] {
  const q = search.trim().toLowerCase();
  return servers.filter((s) => {
    if (filter === "authless" && s.oauth) return false;
    if (filter === "oauth" && !s.oauth) return false;
    if (!q) return true;
    return (s.title || "").toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q);
  });
}
