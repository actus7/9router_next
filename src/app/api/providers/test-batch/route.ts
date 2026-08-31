import { NextRequest, NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { testSingleConnection, testNoAuthProvider } from "../[id]/test/testUtils";

function getAuthGroup(providerId: string, connection: Record<string, unknown> | null = null): string {
  // Prioritize authType from connection if available
  if (connection?.authType) {
    if (connection.authType === "oauth") {
      // Check if it's a free provider
      if (FREE_PROVIDERS[providerId]) return "free";
      return "oauth";
    }
    // apikey connections for free-tier providers belong in the "free" group
    if (FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId]) return "free";
    return connection.authType as string;
  }

  // Fallback to constants
  if (FREE_PROVIDERS[providerId]) return "free";
  if (FREE_TIER_PROVIDERS[providerId]) return "free";
  if (OAUTH_PROVIDERS[providerId]) return "oauth";
  if (APIKEY_PROVIDERS[providerId]) return "apikey";
  if (
    typeof providerId === "string" &&
    (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) || providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX))
  )
    return "compatible";
  return "apikey";
}

function isCompatibleProvider(providerId: string): boolean {
  return (
    typeof providerId === "string" &&
    (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) || providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX))
  );
}

// POST /api/providers/test-batch - Test multiple connections by group
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { mode, providerId } = body;

    if (!mode) {
      return NextResponse.json({ error: "mode is required" }, { status: 400 });
    }

    const allConnections = await getProviderConnections({ isActive: true });

    let connectionsToTest: Record<string, unknown>[] = [];
    if (mode === "provider" && providerId) {
      connectionsToTest = allConnections.filter((c: Record<string, unknown>) => c.provider === providerId);
    } else if (mode === "oauth") {
      connectionsToTest = allConnections.filter((c: Record<string, unknown>) => getAuthGroup(c.provider as string, c) === "oauth");
    } else if (mode === "free") {
      connectionsToTest = allConnections.filter((c: Record<string, unknown>) => getAuthGroup(c.provider as string, c) === "free");
    } else if (mode === "apikey") {
      connectionsToTest = allConnections.filter((c: Record<string, unknown>) => getAuthGroup(c.provider as string, c) === "apikey");
    } else if (mode === "cookie") {
      connectionsToTest = allConnections.filter((c: Record<string, unknown>) => getAuthGroup(c.provider as string, c) === "cookie");
    } else if (mode === "compatible") {
      connectionsToTest = allConnections.filter((c: Record<string, unknown>) => isCompatibleProvider(c.provider as string));
    } else if (mode === "all") {
      connectionsToTest = allConnections;
    } else {
      return NextResponse.json(
        { error: "Invalid mode. Use: provider, oauth, free, apikey, cookie, compatible, all" },
        { status: 400 }
      );
    }

    // For "free" mode, we always proceed (even with 0 connections) to also test noAuth providers
    if (mode !== "free" && connectionsToTest.length === 0) {
      return NextResponse.json({
        mode,
        providerId: providerId || null,
        results: [],
        summary: { total: 0, passed: 0, failed: 0 },
        testedAt: new Date().toISOString(),
      });
    }

    // In "free" mode, skip noAuth providers here — they are always tested
    // via testNoAuthProvider below, even if optional stored connections exist.
    const noAuthProviders = mode === "free"
      ? new Set(
          Object.entries({ ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS } as Record<string, Record<string, unknown>>)
            .filter(([, info]) => info.noAuth)
            .map(([id]) => id)
        )
      : new Set<string>();

    const results: Array<Record<string, unknown>> = [];
    for (const conn of connectionsToTest) {
      if (noAuthProviders.has(conn.provider as string)) continue;
      try {
        const data = await testSingleConnection(conn.id as string);
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name || conn.email || conn.provider,
          authType: conn.authType || getAuthGroup(conn.provider as string, conn),
          valid: data.valid,
          latencyMs: data.latencyMs || 0,
          error: data.error || null,
          diagnosis: data.diagnosis || null,
          statusCode: data.statusCode || null,
          testedAt: data.testedAt || new Date().toISOString(),
        });
      } catch (error) {
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name || conn.email || conn.provider,
          authType: conn.authType || getAuthGroup(conn.provider as string, conn),
          valid: false,
          latencyMs: 0,
          error: (error as Error).message,
          diagnosis: { type: "network_error", source: "local", code: null, message: (error as Error).message },
          statusCode: null,
          testedAt: new Date().toISOString(),
        });
      }
    }

    // For "free" mode: always test noAuth providers via testNoAuthProvider
    // (even if optional stored connections exist — no connection is mutated/deleted),
    // and classify auth-required providers that lack a connection as "skipped".
    if (mode === "free") {
      const allFreeProviders: Record<string, Record<string, unknown>> = { ...FREE_PROVIDERS };
      // Include FREE_TIER_PROVIDERS that have LLM service kind (matching UI filter)
      for (const [pid, info] of Object.entries(FREE_TIER_PROVIDERS as Record<string, Record<string, unknown>>)) {
        const kinds = (info.serviceKinds as string[] | undefined) ?? ["llm"];
        if (kinds.includes("llm")) allFreeProviders[pid] = info;
      }
      // Track non-noAuth providers that already have a tested connection
      const testedProviders = new Set(results.map((r) => r.provider));

      for (const [pId, pInfo] of Object.entries(allFreeProviders)) {
        if (pInfo.hidden) continue;

        if (pInfo.noAuth) {
          const testResult = await testNoAuthProvider(pId);
          results.push({
            provider: pId,
            connectionId: null,
            connectionName: pInfo.name || pId,
            authType: "noauth",
            valid: testResult.valid,
            latencyMs: testResult.latencyMs,
            error: testResult.error,
            diagnosis: testResult.valid ? null : { type: "connectivity", source: "upstream" },
            statusCode: null,
            testedAt: new Date().toISOString(),
          });
        } else if (!testedProviders.has(pId)) {
          results.push({
            provider: pId,
            connectionId: null,
            connectionName: pInfo.name || pId,
            authType: "none",
            valid: false,
            latencyMs: 0,
            error: "No connection configured",
            diagnosis: { type: "no_connection", source: "local" },
            statusCode: null,
            testedAt: new Date().toISOString(),
          });
        }
      }
    }

    return NextResponse.json({
      mode,
      providerId: providerId || null,
      results,
      testedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        passed: results.filter((r) => r.valid).length,
        failed: results.filter((r) => !r.valid).length,
      },
    });
  } catch (error) {
    console.error("Error in batch test:", error);
    return NextResponse.json({ error: "Batch test failed" }, { status: 500 });
  }
}
