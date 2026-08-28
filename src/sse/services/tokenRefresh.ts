// Re-export from open-sse with local logger
import * as log from "../utils/logger";
import { updateProviderConnection } from "../../lib/localDb";
import {
  getProjectIdForConnection,
  invalidateProjectId,
} from "@/lib/open-sse/services/projectId";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshGoogleToken as _refreshGoogleToken,
  refreshCodexToken as _refreshCodexToken,
  refreshCopilotToken as _refreshCopilotToken,
  getRefreshLeadMs as _getRefreshLeadMs
} from "@/lib/open-sse/services/tokenRefresh";
import {
  refreshProviderCredentials as _refreshProviderCredentials,
  shouldRefreshCredentials as _shouldRefreshCredentials,
} from "@/lib/open-sse/services/oauthCredentialManager";

const TOKEN_EXPIRY_BUFFER_MS: number = BUFFER_MS;

// ─── Re-exports wrapped with local logger ─────────────────────────────────────

export const refreshGoogleToken = (refreshToken: string, clientId: string, clientSecret: string) =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log);

export const refreshCodexToken = (refreshToken: string) =>
  _refreshCodexToken(refreshToken, log);

const refreshCopilotToken = (githubAccessToken: string): Promise<{ token: string; expiresAt: number } | null> =>
  _refreshCopilotToken(githubAccessToken, log) as Promise<{ token: string; expiresAt: number } | null>;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute an ISO expiry timestamp from a relative expiresIn (seconds).
 */
function toExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function normalizeExpiresAt(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const date: Date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Providers that carry a real Google project ID.
 */
function needsProjectId(provider: string): boolean {
  return provider === "antigravity" || provider === "gemini-cli";
}

/**
 * Non-blocking: fetch the project ID for a connection after a token refresh.
 */
function _refreshProjectId(provider: string, connectionId: string, accessToken: string): void {
  if (!needsProjectId(provider) || !connectionId || !accessToken) return;

  invalidateProjectId(connectionId);

  getProjectIdForConnection(connectionId, accessToken)
    .then((projectId: string | null) => {
      if (!projectId) return;
      updateProviderCredentials(connectionId, { projectId }).catch((err: Error) => {
        log.debug("TOKEN_REFRESH", "Failed to persist refreshed projectId", {
          connectionId,
          error: err?.message ?? err,
        });
      });
    })
    .catch((err: Error) => {
      log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", {
        connectionId,
        error: err?.message ?? err,
      });
    });
}

// ─── Local-specific: persist credentials to localDb ──────────────────────────

interface NewCredentials {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  lastRefreshAt?: string;
  expiresAt?: string;
  expiresIn?: number;
  providerSpecificData?: Record<string, unknown>;
  existingProviderSpecificData?: Record<string, unknown>;
  copilotToken?: string;
  copilotTokenExpiresAt?: number;
  projectId?: string;
  testStatus?: string;
}

/**
 * Persist updated credentials for a connection to localDb.
 */
export async function updateProviderCredentials(connectionId: string, newCredentials: NewCredentials): Promise<boolean> {
  try {
    const updates: Record<string, unknown> = {};

    if (newCredentials.accessToken)         updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken)        updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.idToken)             updates.idToken = newCredentials.idToken;
    if (newCredentials.lastRefreshAt)       updates.lastRefreshAt = newCredentials.lastRefreshAt;
    if (newCredentials.expiresAt)           updates.expiresAt = newCredentials.expiresAt;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    } else if (newCredentials.expiresAt) {
      const expiresAt: string | null = normalizeExpiresAt(newCredentials.expiresAt);
      if (expiresAt) {
        updates.expiresAt = expiresAt;
        updates.expiresIn = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      }
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...newCredentials.providerSpecificData,
      };
    }
    if (newCredentials.copilotToken || newCredentials.copilotTokenExpiresAt) {
      updates.providerSpecificData = {
        ...(updates.providerSpecificData || newCredentials.existingProviderSpecificData || {}),
        ...(newCredentials.copilotToken ? { copilotToken: newCredentials.copilotToken } : {}),
        ...(newCredentials.copilotTokenExpiresAt ? { copilotTokenExpiresAt: newCredentials.copilotTokenExpiresAt } : {}),
      };
    }
    if (newCredentials.projectId)            updates.projectId = newCredentials.projectId;

    const result: unknown = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: !!result
    });
    return !!result;
  } catch (error: unknown) {
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ─── Local-specific: proactive token refresh ─────────────────────────────────

interface ProviderSpecificData extends Record<string, unknown> {
  copilotToken?: string;
  copilotTokenExpiresAt?: string | number;
}

interface Credentials {
  connectionId?: string;
  id?: string;
  expiresAt?: string;
  lastRefreshAt?: string;
  accessToken?: string;
  refreshToken?: string;
  providerSpecificData?: ProviderSpecificData;
  copilotToken?: string;
  apiKey?: string;
  expiresIn?: number;
  [key: string]: unknown;
}

interface RefreshOptions {
  force?: boolean;
}

/**
 * Check whether the provider token is about to expire and refresh it proactively.
 */
export async function checkAndRefreshToken(provider: string, credentials: Credentials, options: RefreshOptions = {}): Promise<Credentials> {
  let creds: Credentials = { ...credentials };
  if (!creds.connectionId && creds.id) {
    creds.connectionId = creds.id;
  }

  const force: boolean = options?.force === true;

  // ── 1. Regular access-token expiry ────────────────────────────────────────
  if (force || _shouldRefreshCredentials(provider, creds as Parameters<typeof _shouldRefreshCredentials>[1])) {
    const expiresAt: number | null = creds.expiresAt ? new Date(creds.expiresAt).getTime() : null;
    const remaining: number | null = expiresAt ? expiresAt - Date.now() : null;
    const refreshLead: number = _getRefreshLeadMs(provider);

    log.info("TOKEN_REFRESH", "Refreshing provider credentials proactively", {
      provider,
      expiresIn: remaining === null ? null : Math.round(remaining / 1000),
      refreshLeadMs: refreshLead,
      lastRefreshAt: creds.lastRefreshAt || null,
    });

    const newCreds = await _refreshProviderCredentials(
      provider,
      creds as Parameters<typeof _refreshProviderCredentials>[1],
      log,
    ) as Credentials | null;
    if (newCreds?.accessToken || newCreds?.apiKey || newCreds?.copilotToken) {
      const mergedCreds: NewCredentials = {
        ...newCreds,
        existingProviderSpecificData: creds.providerSpecificData,
      };

      await updateProviderCredentials(creds.connectionId!, mergedCreds);

      creds = {
        ...creds,
        ...newCreds,
        expiresAt: newCreds.expiresIn
          ? toExpiresAt(newCreds.expiresIn)
          : normalizeExpiresAt(newCreds.expiresAt) || newCreds.expiresAt || creds.expiresAt,
        providerSpecificData: newCreds.providerSpecificData
          ? { ...creds.providerSpecificData, ...newCreds.providerSpecificData }
          : creds.providerSpecificData,
      };

      _refreshProjectId(provider, creds.connectionId!, creds.accessToken!);
    }
  }

  // ── 2. GitHub Copilot token expiry ────────────────────────────────────────
  if (provider === "github") {
    const copilotToken: string | undefined = creds.providerSpecificData?.copilotToken;
    const copilotExpirySeconds = creds.providerSpecificData?.copilotTokenExpiresAt;
    const copilotExpiresAt: number = copilotExpirySeconds
      ? Number(copilotExpirySeconds) * 1000
      : 0;
    const now: number = Date.now();
    const remaining: number = copilotExpiresAt - now;

    if (!copilotToken || remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon or missing, refreshing proactively", {
        provider,
        expiresIn: copilotToken ? Math.round(remaining / 1000) : "missing",
      });

      const copilotTokenResult: { token: string; expiresAt: number } | null = await refreshCopilotToken(creds.accessToken!);
      if (copilotTokenResult) {
        const updatedSpecific: ProviderSpecificData = {
          ...creds.providerSpecificData,
          copilotToken:          copilotTokenResult.token,
          copilotTokenExpiresAt: copilotTokenResult.expiresAt,
        };

        await updateProviderCredentials(creds.connectionId!, {
          providerSpecificData: updatedSpecific,
        });

        creds.providerSpecificData = updatedSpecific;
        creds.copilotToken = copilotTokenResult.token;
      }
    }
  }

  return creds;
}
