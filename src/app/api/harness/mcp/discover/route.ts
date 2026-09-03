import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { discoverMcpTools } from "@/server/harness/mcpClient";


export async function POST(request: NextRequest) {
  await assertRequestRuntime();
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
