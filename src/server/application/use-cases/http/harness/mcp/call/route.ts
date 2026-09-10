import { NextRequest, NextResponse } from "next/server";
import { callSessionMcpTool } from "@/server/harness/mcpClient";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
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

    return NextResponse.json({
      ok: true,
      // The lookup lives in the domain because the worker needs it too: the
      // target must always come from this account's own persisted session, not
      // from the caller.
      result: await callSessionMcpTool({ sessionId, serverId, runtimeName, args }),
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
