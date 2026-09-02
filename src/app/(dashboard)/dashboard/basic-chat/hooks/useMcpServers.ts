"use client";

import { useState } from "react";
import type { ChatSession, HarnessMcpServer, HarnessMcpTool } from "../types";

interface DiscoverPayload {
  tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>;
  error?: unknown;
}

export function normalizeDiscoveredTools(payload: DiscoverPayload, idForRuntimeName: string): HarnessMcpTool[] {
  const tools = payload.tools ?? [];
  return tools.flatMap((tool, index) =>
    typeof tool.name === "string" && tool.name
      ? [
          {
            name: tool.name,
            description: typeof tool.description === "string" ? tool.description : "MCP tool",
            inputSchema:
              tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
                ? (tool.inputSchema as Record<string, unknown>)
                : { type: "object", properties: {} },
            runtimeName: `mcp_${idForRuntimeName.replace(/-/g, "")}_${index}`,
          },
        ]
      : [],
  );
}

export async function discoverTools(url: string, authToken?: string): Promise<DiscoverPayload> {
  const response = await fetch("/api/harness/mcp/discover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, authToken }),
  });
  const payload = (await response.json().catch(() => null)) as DiscoverPayload | null;
  if (!response.ok || !Array.isArray(payload?.tools)) {
    throw new Error(
      typeof payload?.error === "string" ? payload.error : "Não foi possível descobrir as ferramentas MCP.",
    );
  }
  return payload;
}

export interface UseMcpServersArgs {
  session: ChatSession | null;
  updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
}

export interface UseMcpServersReturn {
  name: string;
  url: string;
  error: string;
  connecting: boolean;
  setName: (value: string) => void;
  setUrl: (value: string) => void;
  addServer: () => void;
  connectServer: (server: HarnessMcpServer) => void;
  toggleServer: (server: HarnessMcpServer) => void;
  removeServer: (serverId: string) => void;
  toggleTool: (serverId: string, runtimeName: string) => void;
  setServerToken: (serverId: string, token: string) => void;
}

/** Owns MCP server discovery/connect/toggle/remove and per-tool enablement for the Harness settings dialog. */
export function useMcpServers({ session, updateSession }: UseMcpServersArgs): UseMcpServersReturn {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const updateServer = (serverId: string, updater: (server: HarnessMcpServer) => HarnessMcpServer) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      mcpServers: (current.mcpServers ?? []).map((server) => (server.id === serverId ? updater(server) : server)),
    }));
  };

  const addServer = async () => {
    if (!session || !url.trim()) return;
    setConnecting(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      const payload = await discoverTools(url.trim());
      const tools = normalizeDiscoveredTools(payload, id);
      if (!tools.length) throw new Error("O servidor MCP não disponibilizou ferramentas compatíveis.");
      const server: HarnessMcpServer = {
        id,
        name: name.trim() || new URL(url.trim()).hostname,
        url: url.trim(),
        enabled: true,
        tools,
        validatedAt: new Date().toISOString(),
      };
      updateSession(session.id, (current) => ({ ...current, mcpServers: [...(current.mcpServers ?? []), server] }));
      setName("");
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível conectar ao MCP.");
    } finally {
      setConnecting(false);
    }
  };

  const connectServer = async (server: HarnessMcpServer) => {
    setConnecting(true);
    setError("");
    try {
      const payload = await discoverTools(server.url, server.authToken);
      const tools = normalizeDiscoveredTools(payload, server.id);
      if (!tools.length) throw new Error("O servidor MCP não disponibilizou ferramentas compatíveis.");
      updateServer(server.id, (current) => ({ ...current, tools, validatedAt: new Date().toISOString() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível conectar ao MCP.");
    } finally {
      setConnecting(false);
    }
  };

  const toggleServer = (server: HarnessMcpServer) => {
    updateServer(server.id, (current) => ({ ...current, enabled: !current.enabled }));
  };

  const removeServer = (serverId: string) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      // Built-in servers can be disabled but never removed.
      mcpServers: (current.mcpServers ?? []).filter((server) => server.id !== serverId || server.builtin),
    }));
  };

  const toggleTool = (serverId: string, runtimeName: string) => {
    updateServer(serverId, (server) => ({
      ...server,
      tools: server.tools.map((tool) =>
        tool.runtimeName === runtimeName ? { ...tool, enabled: tool.enabled === false } : tool,
      ),
    }));
  };

  const setServerToken = (serverId: string, token: string) => {
    updateServer(serverId, (server) => ({ ...server, authToken: token || undefined }));
  };

  return {
    name,
    url,
    error,
    connecting,
    setName,
    setUrl,
    addServer: () => void addServer(),
    connectServer: (server) => void connectServer(server),
    toggleServer,
    removeServer,
    toggleTool,
    setServerToken,
  };
}
