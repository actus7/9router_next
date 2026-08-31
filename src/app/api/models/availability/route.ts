import { NextRequest, NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { cleanupExpiredModelAvailability, clearProviderModelAvailability, getActiveModelAvailability } from "@/lib/db/repos/modelAvailabilityRepo";
export async function GET(): Promise<NextResponse> {
  try {
    await cleanupExpiredModelAvailability();
    const [connections, availability] = await Promise.all([
      getProviderConnections(),
      getActiveModelAvailability(),
    ]);
    const connectionById = new Map(connections.map((connection) => [connection.id as string, connection]));
    const models: Array<{
      provider: string;
      model: string;
      status: "cooldown" | "unavailable";
      until?: string;
      connectionId: string;
      connectionName: string;
      lastError: string | null;
      reason: string;
      errorCode: number | null;
    }> = [];

    for (const record of availability) {
      const connection = connectionById.get(record.connectionId);
      if (!connection) continue;
      models.push({
        provider: connection.provider as string,
        model: record.modelId,
        status: record.status,
        until: record.until || undefined,
        connectionId: record.connectionId,
        connectionName: (connection.name || connection.email || connection.id) as string,
        lastError: record.lastError,
        reason: record.reason,
        errorCode: record.errorCode,
      });
    }

    return NextResponse.json({
      models,
      unavailableCount: models.length,
    });
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    return NextResponse.json(
      { error: "Failed to fetch model availability" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { action, provider, model } = await request.json();

    if (action !== "clearCooldown" || !provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const cleared = await clearProviderModelAvailability(
      connections.map((connection) => connection.id as string),
      model,
    );

    return NextResponse.json({ ok: true, cleared });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json(
      { error: "Failed to clear cooldown" },
      { status: 500 },
    );
  }
}
