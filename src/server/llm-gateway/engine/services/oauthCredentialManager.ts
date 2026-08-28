import {
  getRefreshLeadMs,
  isUnrecoverableRefreshError,
  refreshTokenByProvider,
} from "./tokenRefresh";
import { PROVIDER_OAUTH } from "../providers/index";
import type { Credentials, RefreshResult, Logger, OAuthProviderConfig } from "./types";

// Single source: codex.oauth.maxRefreshAgeMs (8 days) — proactive refresh window
export const CODEX_MAX_REFRESH_AGE_MS = (PROVIDER_OAUTH["codex"] as OAuthProviderConfig | undefined)?.maxRefreshAgeMs;

const refreshLocks = new Map<string, Promise<RefreshResult | null>>();

function parseTimeMs(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toExpiresAt(expiresIn: number, nowMs = Date.now()): string {
  return new Date(nowMs + expiresIn * 1000).toISOString();
}

export function getCredentialExpiryMs(credentials: Credentials): number | null {
  return parseTimeMs(credentials?.expiresAt ?? credentials?.tokenExpiresAt);
}

export function getCredentialLastRefreshMs(credentials: Credentials): number | null {
  return parseTimeMs(
    credentials?.lastRefreshAt ??
    credentials?.lastRefresh ??
    credentials?.providerSpecificData?.lastRefreshAt
  );
}

export function isCodexRefreshStale(credentials: Credentials, nowMs = Date.now(), maxAgeMs?: number): boolean {
  const lastRefreshMs = getCredentialLastRefreshMs(credentials);
  return !lastRefreshMs || (maxAgeMs != null && nowMs - lastRefreshMs >= maxAgeMs);
}

export function shouldRefreshCredentials(provider: string, credentials: Credentials | null, nowMs = Date.now()): boolean {
  if (!credentials) return false;

  const expiresAtMs = getCredentialExpiryMs(credentials);
  if (expiresAtMs !== null && expiresAtMs - nowMs < (getRefreshLeadMs(provider) as number)) {
    return true;
  }

  // Proactive stale refresh for providers declaring oauth.maxRefreshAgeMs (e.g. codex)
  const oauthCfg = PROVIDER_OAUTH[provider] as OAuthProviderConfig | undefined;
  const maxAgeMs = oauthCfg?.maxRefreshAgeMs;
  if (maxAgeMs && credentials.refreshToken && isCodexRefreshStale(credentials, nowMs, maxAgeMs)) {
    return true;
  }

  return false;
}

export function mergeProviderSpecificData(existing: Record<string, unknown> | undefined, next: Record<string, unknown>): Record<string, unknown> {
  if (!next || typeof next !== "object") return existing || {};
  return {
    ...(existing || {}),
    ...next,
  };
}

export function mergeRefreshedCredentials(provider: string, currentCredentials: Credentials | null, refreshedCredentials: RefreshResult | null, nowMs = Date.now()): RefreshResult | null {
  if (!refreshedCredentials) return null;
  if (isUnrecoverableRefreshError(refreshedCredentials)) return refreshedCredentials;

  const next: Record<string, unknown> = {};
  const nowIso = new Date(nowMs).toISOString();

  if (refreshedCredentials.accessToken) next.accessToken = refreshedCredentials.accessToken;
  if (refreshedCredentials.apiKey) next.apiKey = refreshedCredentials.apiKey;
  if (refreshedCredentials.token) next.token = refreshedCredentials.token;

  const refreshToken = refreshedCredentials.refreshToken ?? currentCredentials?.refreshToken;
  if (refreshToken) next.refreshToken = refreshToken;

  const idToken = refreshedCredentials.idToken ?? currentCredentials?.idToken;
  if (idToken) next.idToken = idToken;

  if (refreshedCredentials.expiresIn) {
    next.expiresIn = refreshedCredentials.expiresIn;
    next.expiresAt = toExpiresAt(refreshedCredentials.expiresIn, nowMs);
  } else if (refreshedCredentials.expiresAt) {
    next.expiresAt = refreshedCredentials.expiresAt;
  }

  if (refreshedCredentials.projectId) next.projectId = refreshedCredentials.projectId;

  if (refreshedCredentials.providerSpecificData) {
    next.providerSpecificData = mergeProviderSpecificData(
      currentCredentials?.providerSpecificData,
      refreshedCredentials.providerSpecificData
    );
  }

  if (refreshedCredentials.copilotToken) next.copilotToken = refreshedCredentials.copilotToken;
  if (refreshedCredentials.copilotTokenExpiresAt) {
    next.copilotTokenExpiresAt = refreshedCredentials.copilotTokenExpiresAt;
  }

  // trackRefreshAt providers (e.g. codex) always stamp lastRefreshAt for staleness tracking
  const oauthCfg = PROVIDER_OAUTH[provider] as OAuthProviderConfig | undefined;
  if (
    oauthCfg?.trackRefreshAt ||
    next.accessToken ||
    next.apiKey ||
    next.token ||
    next.refreshToken ||
    next.copilotToken
  ) {
    next.lastRefreshAt = refreshedCredentials.lastRefreshAt || nowIso;
  }

  return next as RefreshResult;
}

function getRefreshLockKey(provider: string, credentials: Credentials): string {
  const stableId =
    credentials?.connectionId ||
    credentials?.id ||
    credentials?.email ||
    credentials?.name ||
    credentials?.refreshToken?.slice?.(-16) ||
    "default";
  return `${provider}:${stableId}`;
}

export async function withCredentialRefreshLock(provider: string, credentials: Credentials, refreshFn: () => Promise<RefreshResult | null>): Promise<RefreshResult | null> {
  const key = getRefreshLockKey(provider, credentials);
  const existing = refreshLocks.get(key);
  if (existing) return existing;

  const pending = Promise.resolve()
    .then(refreshFn)
    .finally(() => {
      refreshLocks.delete(key);
    });

  refreshLocks.set(key, pending);
  return pending;
}

export async function refreshProviderCredentials(provider: string, credentials: Credentials | null, log?: Logger): Promise<RefreshResult | null> {
  if (!credentials) return null;

  return withCredentialRefreshLock(provider, credentials, async () => {
    const refreshed = await refreshTokenByProvider(provider, credentials, log);
    return mergeRefreshedCredentials(provider, credentials, refreshed);
  });
}
