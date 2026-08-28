import { NextRequest, NextResponse } from "next/server";
import {
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";

const MODEL_LOCK_PREFIX = "modelLock_";

interface ModelLock {
  key: string;
  model: string;
  until: string;
  active: boolean;
}

function getActiveModelLocks(connection: Record<string, unknown>): ModelLock[] {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value as string,
      active: new Date(value as string).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

export async function GET(): Promise<NextResponse> {
  try {
    const connections = await getProviderConnections();
    const models: Array<{
      provider: string;
      model: string;
      status: string;
      until?: string;
      connectionId: string;
      connectionName: string;
      lastError: string | null;
    }> = [];

    for (const connection of connections) {
      const locks = getActiveModelLocks(connection);
      for (const lock of locks) {
        models.push({
          provider: connection.provider as string,
          model: lock.model,
          status: "cooldown",
          until: lock.until,
          connectionId: connection.id as string,
          connectionName: (connection.name || connection.email || connection.id) as string,
          lastError: connection.lastError ? String(connection.lastError) : null,
        });
      }

      if (locks.length === 0 && connection.testStatus === "unavailable") {
        models.push({
          provider: connection.provider as string,
          model: "__all",
          status: "unavailable",
          connectionId: connection.id as string,
          connectionName: (connection.name || connection.email || connection.id) as string,
          lastError: connection.lastError ? String(connection.lastError) : null,
        });
      }
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
    const lockKey = `${MODEL_LOCK_PREFIX}${model}`;

    await Promise.all(
      connections
        .filter((connection: Record<string, unknown>) => connection[lockKey])
        .map((connection: Record<string, unknown>) =>
          updateProviderConnection(connection.id as string, {
            [lockKey]: null,
            ...(connection.testStatus === "unavailable"
              ? {
                  testStatus: "active",
                  lastError: null,
                  lastErrorAt: null,
                  backoffLevel: 0,
                }
              : {}),
          }),
        ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json(
      { error: "Failed to clear cooldown" },
      { status: 500 },
    );
  }
}
