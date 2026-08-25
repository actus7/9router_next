import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "@/lib/open-sse/services/accountFallback";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "@/lib/open-sse/config/errorConfig";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger";

// Mutex to prevent race conditions during account selection
let selectionMutex: Promise<void> = Promise.resolve();

const GITHUB_MONTHLY_USAGE_LIMIT: string = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status: number, errorText: string, provider: string): number | null {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now: Date = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

interface CredentialsResult {
  id?: string;
  authType?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: string;
  expiresIn?: number;
  lastRefreshAt?: string;
  projectId?: string;
  connectionName?: string;
  copilotToken?: string;
  providerSpecificData?: Record<string, any>;
  connectionId?: string;
  testStatus?: string;
  lastError?: string;
  _connection?: Record<string, any>;
  allRateLimited?: boolean;
  retryAfter?: number;
  retryAfterHuman?: string;
  lastErrorCode?: number;
  isActive?: boolean;
}

interface GetCredentialsOptions {
  preferredConnectionId?: string;
}

/**
 * Get provider credentials from localDb
 */
export async function getProviderCredentials(
  provider: string,
  excludeConnectionIds: Set<string> | string | null = null,
  model: string | null = null,
  options: GetCredentialsOptions = {}
): Promise<CredentialsResult | null> {
  const excludeSet: Set<string> = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId: string | null = options?.preferredConnectionId || null;
  const currentMutex: Promise<void> = selectionMutex;
  let resolveMutex: (() => void) | undefined;
  selectionMutex = new Promise<void>(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    const providerId: string = resolveProviderId(provider);

    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings: any = await getSettings();
      const override: any = (settings.providerStrategies || {})[providerId] || {};
      const strategy: string = override.rotateStrategy || "none";
      let pickedId: string | null = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools: any[] = await getProxyPools({ isActive: true });
        const poolIds: string[] = allPools.filter((p: any) => p.proxyUrl).map((p: any) => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy: any = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }

    const connections: any[] = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    const availableConnections: any[] = connections.filter((c: any) => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach((c: any) => {
      const excluded: boolean = excludeSet.has(c.id);
      const locked: boolean = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil: number | null = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      const lockedConns: any[] = connections.filter((c: any) => isModelLockActive(c, model));
      const expiries: (number | null)[] = lockedConns.map((c: any) => getEarliestModelLockUntil(c)).filter(Boolean);
      const earliest: string | null = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn: any = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest as any,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings: any = await getSettings();
    const providerOverride: any = (settings.providerStrategies || {})[providerId] || {};
    const strategy: string = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection: any;
    if (preferredConnectionId) {
      connection = availableConnections.find((c: any) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit: number = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      const byRecency: any[] = [...availableConnections].sort((a: any, b: any) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
      });

      const current: any = byRecency[0];
      const currentCount: number = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        connection = current;
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        const sortedByOldest: any[] = [...availableConnections].sort((a: any, b: any) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt).getTime() - new Date(b.lastUsedAt).getTime();
        });

        connection = sortedByOldest[0];

        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
      }
    } else {
      connection = availableConnections[0];
    }

    const resolvedProxy: any = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

interface MarkUnavailableResult {
  shouldFallback: boolean;
  cooldownMs: number;
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 */
export async function markAccountUnavailable(
  connectionId: string,
  status: number,
  errorText: string,
  provider: string | null = null,
  model: string | null = null,
  resetsAtMs: number | null = null
): Promise<MarkUnavailableResult> {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections: any[] = await getProviderConnections({ provider });
  const conn: any = connections.find((c: any) => c.id === connectionId);
  const backoffLevel: number = conn?.backoffLevel || 0;

  const githubResetAtMs: number | null = githubMonthlyResetMs(status, errorText, provider!);

  let shouldFallback: boolean, cooldownMs: number, newBackoffLevel: number;
  if (githubResetAtMs) {
    shouldFallback = true;
    cooldownMs = githubResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason: string = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate: Record<string, string | null> = buildModelLockUpdate(githubResetAtMs ? null : model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey: string = Object.keys(lockUpdate)[0];
  const connName: string = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 */
export async function clearAccountError(connectionId: string, currentConnection: any, model: string | null = null): Promise<void> {
  if (!connectionId || connectionId === "noauth") return;
  const conn: any = currentConnection._connection || currentConnection;
  const now: number = Date.now();
  const allLockKeys: string[] = Object.keys(conn).filter((k: string) => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  const keysToClear: string[] = allLockKeys.filter((k: string) => {
    if (model && k === `modelLock_${model}`) return true;
    if (model && k === "modelLock___all") return true;
    const expiry: string | null = conn[k];
    return expiry && new Date(expiry).getTime() <= now;
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  const remainingActiveLocks: string[] = allLockKeys.filter((k: string) => {
    if (keysToClear.includes(k)) return false;
    const expiry: string | null = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj: Record<string, any> = Object.fromEntries(keysToClear.map((k: string) => [k, null]));

  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request: Request): string | null {
  const authHeader: string | null = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const xApiKey: string | null = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
