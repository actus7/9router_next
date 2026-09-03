import { NextRequest, NextResponse } from "next/server";
import { callMcpTool } from "@/server/harness/mcpClient";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { listHarnessConversations } from "@/lib/db/repos/harnessConversationsRepo";

interface StoredMcpServer {
  id?: unknown;
  url?: unknown;
  tools?: unknown;
  enabled?: unknown;
  authToken?: unknown;
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  try {
    const { sessionId, serverId, runtimeName, arguments: args } = await request.json();
    if (
      typeof sessionId !== "string" ||
      typeof serverId !== "string" ||
      typeof runtimeName !== "string"
    )
      throw new Error("Configuração MCP inválida.");
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Argumentos MCP inválidos.");

    // The client only supplies IDs — the actual URL is looked up from the
    // server's own persisted, previously-validated session record. This
    // closes SSRF via an arbitrary client-supplied URL.
    const conversations = await listHarnessConversations();
    const conversation = conversations.find((item) => item.id === sessionId);
    const mcpServers = Array.isArray(conversation?.mcpServers)
      ? (conversation.mcpServers as StoredMcpServer[])
      : [];
    const server = mcpServers.find(
      (item) => item && typeof item === "object" && item.id === serverId,
    );
    if (!server || typeof server.url !== "string" || !Array.isArray(server.tools))
      throw new Error("Servidor MCP não encontrado nesta sessão.");
    if (server.enabled === false)
      throw new Error("Servidor MCP está desativado nesta sessão.");

    const tool = server.tools.find(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        (item as { runtimeName?: unknown }).runtimeName === runtimeName,
    ) as { name?: unknown; enabled?: unknown } | undefined;
    if (!tool || typeof tool.name !== "string")
      throw new Error("Ferramenta MCP não está habilitada nesta sessão.");
    if (tool.enabled === false)
      throw new Error("Ferramenta MCP está desativada nesta sessão.");

    const authToken = typeof server.authToken === "string" && server.authToken ? server.authToken : undefined;
    return NextResponse.json({
      ok: true,
      result: await callMcpTool(server.url, tool.name, args, authToken),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Falha ao executar ferramenta MCP.",
      },
      { status: 400 },
    );
  }
}
