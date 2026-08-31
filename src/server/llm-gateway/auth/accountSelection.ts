import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getProviderConnections, updateProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProxyPools } from "@/lib/db/repos/proxyPoolsRepo";
import { validateApiKey } from "@/lib/db/repos/apiKeysRepo";
import { getActiveModelAvailability, setModelAvailability, clearModelAvailability } from "@/lib/db/repos/modelAvailabilityRepo";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError } from "@/server/llm-gateway/engine/services/accountFallback";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "@/server/llm-gateway/engine/config/errorConfig";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger";
import type { Connection, Settings } from "@/lib/data-access";

// Mutex to prevent race conditions during account selection
let selectionMutex: Promise<void> = Promise.resolve();

const GITHUB_MONTHLY_USAGE_LIMIT: string = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status: number, errorText: string, provider: string): number | null {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now: Date = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

export interface CredentialsResult extends Record<string, unknown> {
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
  providerSpecificData?: Record<string, unknown>;
  connectionId?: string;
  testStatus?: string;
  lastError?: string;
  _connection?: Record<string, unknown>;
  allRateLimited?: boolean;
  retryAfter?: number;
  retryAfterHuman?: string;
  lastErrorCode?: number;
  isActive?: boolean;
}

interface ProviderStrategy extends Record<string, unknown> {
  fallbackStrategy?: string;
  rotateStrategy?: string;
  proxyPoolId?: string;
  stickyRoundRobinLimit?: number;
}

interface AuthSettings extends Settings {
  providerStrategies: Record<string, ProviderStrategy>;
  fallbackStrategy?: string;
}

interface AuthConnection extends Connection {
  accessToken?: string;
  apiKey?: string;
  backoffLevel?: number;
  consecutiveUseCount?: number;
  displayName?: string;
  errorCode?: number;
  expiresAt?: string;
  expiresIn?: number;
  idToken?: string;
  lastError?: string;
  lastRefreshAt?: string;
  lastUsedAt?: string;
  projectId?: string;
  providerSpecificData?: Record<string, unknown>;
  refreshToken?: string;
  testStatus?: string;
}

interface AuthProxyPool extends Record<string, unknown> {
  id: string;
  proxyUrl?: string;
}

interface ResolvedProxyConfig {
  connectionNoProxy?: string;
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  proxyPoolId?: string;
  vercelRelayUrl?: string;
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
      const settings = await getSettings() as AuthSettings;
      const override: ProviderStrategy = settings.providerStrategies[providerId] || {};
      const strategy: string = override.rotateStrategy || "none";
      let pickedId: string | null = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true }) as AuthProxyPool[];
        const poolIds = allPools.filter((pool) => Boolean(pool.proxyUrl)).map((pool) => pool.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" }) as ResolvedProxyConfig;
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

    const connections = await getProviderConnections({ provider: providerId, isActive: true }) as AuthConnection[];
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    const activeAvailability = await getActiveModelAvailability(connections.map((connection) => connection.id), model);
    const availabilityByConnection = new Map(activeAvailability.map((availability) => [availability.connectionId, availability]));
    const availableConnections = connections.filter((connection) => {
      if (excludeSet.has(connection.id)) return false;
      if (availabilityByConnection.has(connection.id)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach((connection) => {
      const excluded: boolean = excludeSet.has(connection.id);
      const availability = availabilityByConnection.get(connection.id);
      const locked: boolean = Boolean(availability);
      if (excluded || locked) {
        const lockUntil = availability?.until;
        log.debug("AUTH", `  → ${connection.id.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      const lockedConns = connections.filter((connection) => availabilityByConnection.has(connection.id));
      const expiries = lockedConns.map((connection) => availabilityByConnection.get(connection.id)?.until).filter((expiry): expiry is string => Boolean(expiry));
      const earliest: string | null = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: Date.parse(earliest),
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError ?? undefined,
          lastErrorCode: earliestConn?.errorCode ?? undefined
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings() as AuthSettings;
    const providerOverride: ProviderStrategy = settings.providerStrategies[providerId] || {};
    const strategy: string = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection: AuthConnection | undefined;
    if (preferredConnectionId) {
      connection = availableConnections.find((candidate) => candidate.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit: number = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
      });

      const current = byRecency[0];
      const currentCount: number = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        connection = current;
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        const sortedByOldest = [...availableConnections].sort((a, b) => {
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

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {}) as ResolvedProxyConfig;

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
      copilotToken: typeof connection.providerSpecificData?.copilotToken === "string" ? connection.providerSpecificData.copilotToken : undefined,
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
 * Mark an account's model availability without changing connection health.
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
  const connections = await getProviderConnections({ provider: provider ?? undefined }) as AuthConnection[];
  const conn = connections.find((connection) => connection.id === connectionId);
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
    ({ shouldFallback, cooldownMs = 0, newBackoffLevel = 0 } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const lastError: string = typeof errorText === "string" ? errorText.replace(/[\r\n\t]+/g, " ").slice(0, 300) : "Provider error";
  const reason = status === 402 ? "billing"
    : status === 429 ? "rate_limit"
    : status === 404 ? "model"
    : status === 502 || status === 503 ? "transient"
    : "quota";
  const until = new Date(Date.now() + Math.max(cooldownMs, 0)).toISOString();
  const modelId = githubResetAtMs ? "__all" : (model || "__all");

  await setModelAvailability({
    connectionId,
    modelId,
    status: "cooldown",
    reason,
    errorCode: status || null,
    lastError,
    until,
  });

  await updateProviderConnection(connectionId, {
    // A fallback failure is scoped to this model and cooldown. It is not a
    // failed connection test: persisting `unavailable` here makes an expired
    // model lock look like every model in the provider is broken.
    ...(conn?.testStatus === "unavailable" ? { testStatus: "active" } : {}),
    lastError,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const connName: string = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${modelId} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && lastError) {
    console.error(`❌ ${provider} [${status}]: ${lastError}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 */
export async function clearAccountError(connectionId: string, currentConnection: CredentialsResult | Record<string, unknown>, model: string | null = null): Promise<void> {
  if (!connectionId || connectionId === "noauth") return;
  const conn = (currentConnection._connection || currentConnection) as Record<string, unknown>;
  await clearModelAvailability(connectionId, model);

  // Old fallback versions persisted model failures as connection failures.
  // Keep genuine connection-test results intact; only recover that legacy state.
  if (conn.testStatus === "unavailable") {
    await updateProviderConnection(connectionId, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
  }
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
