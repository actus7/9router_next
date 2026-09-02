import type { ChatSession, HarnessMcpServer } from "@/app/(dashboard)/dashboard/basic-chat/types";

export interface BuiltinMcpServerDefinition {
  id: string;
  name: string;
  url: string;
  description: string;
  /** Whether the server requires a user-supplied bearer token to work at all. */
  requiresToken: boolean;
}

/**
 * Classic MCP servers composed into every session by default. They can be
 * disabled per session but never removed — see HarnessMcpServer.builtin.
 */
export const BUILTIN_MCP_SERVERS: readonly BuiltinMcpServerDefinition[] = [
  {
    id: "builtin-context7",
    name: "Context7",
    url: "https://mcp.context7.com/mcp",
    description: "Documentação de bibliotecas e frameworks atualizada. Funciona sem token; um token aumenta o limite de uso.",
    requiresToken: false,
  },
  {
    id: "builtin-github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    description: "Repositórios, issues e pull requests do GitHub. Requer um token pessoal (PAT) para funcionar.",
    requiresToken: true,
  },
];

/**
 * Adds any missing built-in servers to a session's mcpServers, preserving
 * existing entries (including their enabled/tools/authToken state)
 * untouched. Safe to call on every hydration — a no-op once all built-ins
 * are already present.
 */
export function ensureBuiltinMcpServers(session: ChatSession): ChatSession {
  const existingIds = new Set((session.mcpServers ?? []).map((server) => server.id));
  const missing = BUILTIN_MCP_SERVERS.filter((definition) => !existingIds.has(definition.id));
  if (missing.length === 0) return session;
  const added: HarnessMcpServer[] = missing.map((definition) => ({
    id: definition.id,
    name: definition.name,
    url: definition.url,
    enabled: true,
    tools: [],
    validatedAt: "",
    builtin: true,
  }));
  return { ...session, mcpServers: [...(session.mcpServers ?? []), ...added] };
}
