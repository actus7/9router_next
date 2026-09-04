import { NextRequest } from "next/server";
// Ensure proxyFetch is loaded to patch globalThis.fetch
import { getUsageForProvider, getExecutor } from "@/server/llm-gateway/usage";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { getUsageStats } from "@/lib/db/repos/usageRepo";

// Detect auth-expired messages returned by usage providers instead of throwing
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage: Record<string, unknown>) {
  if (!usage?.message) return false;
  const msg = (usage.message as string).toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Refresh credentials using executor and update database
 * @param {boolean} force - Skip needsRefresh check and always attempt refresh
 * @returns Promise<{ connection, refreshed: boolean }>
 */
export async function refreshAndUpdateCredentials(connection: Record<string, unknown>, force = false, proxyOptions: Record<string, unknown> | null = null) {
  const executor = getExecutor(connection.provider as string);

  // Build credentials object from connection
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData: connection.providerSpecificData,
    // For GitHub
    copilotToken: (connection.providerSpecificData as Record<string, unknown>)?.copilotToken,
    copilotTokenExpiresAt: (connection.providerSpecificData as Record<string, unknown>)?.copilotTokenExpiresAt,
  };

  // Check if refresh is needed (skip when force=true)
  const needsRefresh = force || executor.needsRefresh(credentials);

  if (!needsRefresh) {
    return { connection, refreshed: false };
  }

  // Use executor's refreshCredentials method (with optional proxy)
  const refreshResult = await executor.refreshCredentials(credentials, console, proxyOptions);

  if (!refreshResult) {
    // Refresh failed but we still have an accessToken — try with existing token
    if (connection.accessToken) {
      return { connection, refreshed: false };
    }
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }

  // Build update object
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    updatedAt: now,
  };

  // Update accessToken if present
  if (refreshResult.accessToken) {
    updateData.accessToken = refreshResult.accessToken;
  }

  // Update refreshToken if present
  if (refreshResult.refreshToken) {
    updateData.refreshToken = refreshResult.refreshToken;
  }

  if (refreshResult.idToken) {
    updateData.idToken = refreshResult.idToken;
  }

  if (refreshResult.lastRefreshAt) {
    updateData.lastRefreshAt = refreshResult.lastRefreshAt;
  }

  // Update token expiry
  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    updateData.expiresIn = refreshResult.expiresIn;
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  // Handle provider-specific data (copilotToken for GitHub, etc.)
  const providerSpecificUpdates = {
    ...(refreshResult.providerSpecificData || {}),
    ...(refreshResult.copilotToken ? { copilotToken: refreshResult.copilotToken } : {}),
    ...(refreshResult.copilotTokenExpiresAt ? { copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }

  // Update database
    await updateProviderConnection(connection.id as string, updateData);

    // Return updated connection
    const updatedConnection = {
      ...connection,
      ...updateData,
      providerSpecificData: (updateData.providerSpecificData as Record<string, unknown>) || (connection.providerSpecificData as Record<string, unknown>),
    } as Record<string, unknown>;

  return {
    connection: updatedConnection,
    refreshed: true,
  };
}

/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  let connection;
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const { connectionId } = await params;

    if (connectionId.startsWith("usage:")) {
      const provider = connectionId.slice("usage:".length);
      const usage = (await getUsageStats("all")).byProvider[provider];
      if (!usage) return Response.json({ error: "Observed usage provider not found" }, { status: 404 });
      const tokens = Number(usage.promptTokens || 0) + Number(usage.completionTokens || 0);
      return Response.json({
        quotas: {},
        message: `This provider does not expose a quota API. Recorded usage: ${Number(usage.requests || 0).toLocaleString()} requests and ${tokens.toLocaleString()} tokens.`,
      });
    }


    // Get connection from database
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    // Allow OAuth connections, plus whitelisted apikey providers (glm/minimax/kiro/...)
    // Kiro's headless api-key flow persists authType "api_key" (underscore) while
    // generic apikey providers persist "apikey" — accept both spellings here.
    const isOAuth = connection.authType === "oauth";
    const isApikeyAuth =
      connection.authType === "apikey" || connection.authType === "api_key";
    const isApikeyEligible =
      isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);

    if (!isOAuth && !isApikeyEligible) {
      return Response.json({ message: "Usage not available for this connection" });
    }

    // Resolve connection proxy config; force strictProxy=false so quota/refresh fall back to direct on failure
    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    // Refresh credentials only for OAuth connections (apikey has no token refresh)
    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = result.connection;
      } catch (refreshError: unknown) {
        console.error("[Usage API] Credential refresh failed:", refreshError);
        return Response.json({
          error: `Credential refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`
        }, { status: 401 });
      }
    }

    // Fetch usage from provider API
    let usage = await getUsageForProvider(connection as never, proxyOptions as never, { force });

    // If provider returned an auth-expired message instead of throwing,
    // force-refresh token and retry once (OAuth only)
    if (isOAuth && isAuthExpiredMessage(usage as Record<string, unknown>) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        usage = await getUsageForProvider(connection as never, proxyOptions as never, { force });
      } catch (retryError: unknown) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    }

    return Response.json(usage);
  } catch (error: unknown) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
