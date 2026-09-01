"use client";

import { useEffect, useMemo, useState } from "react";
import { filterServers } from "./mcpMarketplaceHelpers";

const REGISTRY_ENDPOINT = "/api/cli-tools/cowork-mcp-registry";
const TOOLS_ENDPOINT = "/api/cli-tools/cowork-mcp-tools";

export interface McpServer {
  url: string; slug?: string; name?: string; title?: string;
  description?: string; iconUrl?: string; oauth?: boolean;
  transport?: string; toolCount?: number; toolNames?: string[];
}
export interface ToolCacheEntry { tools: { name: string }[]; requiresAuth?: boolean; error?: string; }

export function useMcpMarketplace(isOpen: boolean, addedNames: string[]) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [toolsCache, setToolsCache] = useState<Record<string, ToolCacheEntry>>({});
  const [toolsLoading, setToolsLoading] = useState<Record<string, boolean>>({});
  const [toolSelection, setToolSelection] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    if (!isOpen || servers.length > 0) return;
    setLoading(true);
    fetch(REGISTRY_ENDPOINT).then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setServers(d.servers || []); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOpen, servers.length]);

  const addedSet = useMemo(() => new Set(addedNames), [addedNames]);

  const filtered = useMemo(() => filterServers(servers, search, filter), [servers, search, filter]);

  const fetchTools = async (server: McpServer) => {
    if (toolsCache[server.url]) return;
    setToolsLoading((p) => ({ ...p, [server.url]: true }));
    try {
      const r = await fetch(TOOLS_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: server.url }) });
      const d = await r.json();
      const tools = d.tools || [];
      const fallback = Array.isArray(server.toolNames) ? server.toolNames : [];
      const toolNames = tools.length > 0 ? tools.map((t: { name: string }) => t.name) : fallback;
      setToolsCache((p) => ({ ...p, [server.url]: { tools, requiresAuth: !!d.requiresAuth, error: d.error } }));
      setToolSelection((p) => ({ ...p, [server.url]: Object.fromEntries(toolNames.map((t: string) => [t, true])) }));
    } catch (e: unknown) {
      setToolsCache((p) => ({ ...p, [server.url]: { tools: [], error: e instanceof Error ? e.message : String(e) } }));
    } finally { setToolsLoading((p) => ({ ...p, [server.url]: false })); }
  };

  const expandServer = (server: McpServer) => {
    if (expandedUrl === server.url) { setExpandedUrl(null); return; }
    setExpandedUrl(server.url); fetchTools(server);
  };
  const toggleTool = (url: string, tool: string) => setToolSelection((prev) => ({ ...prev, [url]: { ...prev[url], [tool]: !prev[url]?.[tool] } }));
  const setAllTools = (url: string, value: boolean) => { const sel = toolSelection[url] || {}; setToolSelection((prev) => ({ ...prev, [url]: Object.fromEntries(Object.keys(sel).map((t) => [t, value])) })); };

  return {
    servers, loading, search, setSearch, filter, setFilter, error,
    expandedUrl, toolsCache, toolsLoading, toolSelection, addedSet, filtered,
    expandServer, toggleTool, setAllTools,
  };
}
