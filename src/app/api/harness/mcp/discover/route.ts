import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";
import { discoverMcpTools } from "@/server/harness/mcpClient";


export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  // The URL and the token come from the caller and the server opens a session
  // with them, so this is owner authority — the same gate `mcp/call` applies.
  // mcpClient already blocks private targets; this stops an unauthenticated
  // caller from using the server as an outbound client at all.
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  try {
    const { url, authToken } = await request.json();
    if (typeof url !== "string" || !url.trim())
      return NextResponse.json(
        { error: "URL do servidor MCP é obrigatória." },
        { status: 400 },
      );
    const token = typeof authToken === "string" && authToken.trim() ? authToken.trim() : undefined;
    return NextResponse.json({ tools: await discoverMcpTools(url.trim(), token) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível conectar ao servidor MCP.",
      },
      { status: 400 },
    );
  }
}
