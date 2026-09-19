import { NextRequest, NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { listConnectionModels } from "./listConnectionModels";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/providers/[id]/models - Get models list from provider
 *
 * The listing itself lives in `listConnectionModels`, shared with the
 * background discovery in `server/llm-gateway/catalog/discovery`.
 */
export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const result = await listConnectionModels(connection as unknown as Record<string, unknown>);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models: result.models,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error) {
    console.error("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
