import { NextRequest } from "next/server";
// Ensure proxyFetch is loaded to patch globalThis.fetch
import { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "@/server/llm-gateway/usage";

import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/server/application/use-cases/http/usage/[connectionId]/route";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result: Record<string, unknown>) {
  const values = [result?.message, result?.code, (result?.raw as Record<string, unknown>)?.detail, (result?.raw as Record<string, unknown>)?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function isAuthExpiredError(error: unknown) {
  return isAuthExpiredResult({ message: (error as Error)?.message });
}

function getResponseForConsumeResult(result: Record<string, unknown>, redeemRequestId: string) {
  if (result.ok) {
    return Response.json({
      code: result.code,
      reset: true,
      windows_reset: result.windowsReset,
      redeemRequestId,
      credit: (result.raw as Record<string, unknown>)?.credit || null,
    });
  }

  if (result.noCredit) {
    return Response.json({
      code: "no_credit",
      reset: false,
      windows_reset: result.windowsReset,
      message: "No Codex reset credits available.",
    }, { status: 409 });
  }

  return Response.json({
    code: result.code || "unknown_response",
    reset: false,
    windows_reset: result.windowsReset,
    message: result.message || "Codex reset credit consume returned an unexpected response.",
  }, { status: (result.status as number) >= 400 && (result.status as number) < 500 ? result.status as number : 502 });
}

async function getCodexConnection(connectionId: string) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return { response: Response.json({ error: "Connection not found" }, { status: 404 }) };
  }

  if (connection.provider !== "codex") {
    return { response: Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 }) };
  }

  const isOAuth = connection.authType === "oauth";
  const isAccessToken = connection.authType === "access_token";
  if (!isOAuth && !isAccessToken) {
    return { response: Response.json({ error: "Codex reset credits require an OAuth or access-token connection." }, { status: 400 }) };
  }

  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  return { connection, isOAuth, proxyOptions };
}

async function refreshCodexConnection(connection: Record<string, unknown>, proxyOptions: Record<string, unknown>) {
  try {
    const result = await refreshAndUpdateCredentials(connection, false, proxyOptions as never);
    return { connection: result.connection };
  } catch (refreshError: unknown) {
    console.error("[Codex Reset Credits API] Credential refresh failed:", refreshError);
    return { response: Response.json({ error: `Credential refresh failed: ${(refreshError as Error).message}` }, { status: 401 }) };
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  let connection: Record<string, unknown> | undefined;
  try {
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved as { connection: Record<string, unknown> });
    const { isOAuth, proxyOptions } = resolved as { isOAuth: boolean; proxyOptions: Record<string, unknown> };

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection!, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    let result;
    try {
      result = await getCodexRateLimitResetCredits(connection!.accessToken as string, proxyOptions as never, connection!.providerSpecificData as Record<string, unknown>);
    } catch (fetchError) {
      if (!isOAuth || !connection!.refreshToken || !isAuthExpiredError(fetchError)) throw fetchError;
      const retryResult = await refreshAndUpdateCredentials(connection!, true, proxyOptions as never);
      connection = retryResult.connection;
      result = await getCodexRateLimitResetCredits(connection!.accessToken as string, proxyOptions as never, connection!.providerSpecificData as Record<string, unknown>);
    }

    return Response.json(result);
  } catch (error: unknown) {
    const provider = (connection as Record<string, unknown>)?.provider ?? "unknown";
    console.warn(`[Codex Reset Credits] ${provider}: ${(error as Error).message}`);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  let connection: Record<string, unknown> | undefined;
  try {
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved as { connection: Record<string, unknown> });
    const { isOAuth, proxyOptions } = resolved as { isOAuth: boolean; proxyOptions: Record<string, unknown> };

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection!, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    // Server-generated redeem id prevents client-controlled replay
    const redeemRequestId = crypto.randomUUID();
    let consumeResult = await consumeCodexRateLimitResetCredit(connection!.accessToken as string, redeemRequestId, proxyOptions as never);

    if (isOAuth && isAuthExpiredResult(consumeResult as Record<string, unknown>) && connection!.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection!, true, proxyOptions as never);
        connection = retryResult.connection;
        consumeResult = await consumeCodexRateLimitResetCredit(connection!.accessToken as string, redeemRequestId, proxyOptions as never);
      } catch (retryError: unknown) {
        console.warn(`[Codex Reset Credits] force refresh failed: ${(retryError as Error).message}`);
      }
    }

    return getResponseForConsumeResult(consumeResult as Record<string, unknown>, redeemRequestId);
  } catch (error: unknown) {
    const provider = (connection as Record<string, unknown>)?.provider ?? "unknown";
    console.warn(`[Codex Reset Credits] ${provider}: ${(error as Error).message}`);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
