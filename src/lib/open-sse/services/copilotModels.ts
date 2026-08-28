/**
 * GitHub Copilot model catalog fetcher.
 *
 * Calls Copilot's `GET /models` endpoint to get the live catalog for an
 * authenticated account, so `/v1/models` reflects what the account can
 * actually use (e.g. newly shipped `claude-opus-4.8`, `gpt-5.5`) instead of
 * the hand-maintained static registry, which inevitably lags behind.
 *
 * Returns chat-capable models the account's policy allows. Embeddings and
 * disabled models are filtered out.
 */

import { proxyAwareFetch } from "../utils/proxyFetch";
import { GITHUB_COPILOT } from "../config/appConstants";
import { refreshCopilotToken } from "./tokenRefresh";
import type { Credentials, Logger } from "./types";

const MODELS_URL = "https://api.githubcopilot.com/models";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per credential

interface CatalogCacheEntry {
  expiresAt: number;
  models: { id: string; name: string }[];
}

/** @type {Map<string, { expiresAt: number, models: any[] }>} */
const catalogCache = new Map<string, CatalogCacheEntry>();

function cacheKey(credentials: Credentials): string {
  return credentials?.providerSpecificData?.copilotToken
    || credentials?.accessToken
    || "copilot-anonymous";
}

function buildHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Copilot-Integration-Id": "vscode-chat",
    "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
    "user-agent": GITHUB_COPILOT.USER_AGENT || "",
    "x-github-api-version": GITHUB_COPILOT.API_VERSION || "",
  };
}

interface CopilotError extends Error {
  status?: number;
}

async function fetchCatalogRaw(token: string, signal?: AbortSignal | null): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(MODELS_URL, {
      method: "GET",
      headers: buildHeaders(token),
      cache: "no-store",
      signal: signal || controller.signal,
    }) as Response;
    if (!response.ok) {
      const err: CopilotError = new Error(`Copilot /models returned ${response.status}`);
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data : [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// Keep only chat models the account is allowed to use. The static registry
// surfaced disabled/embedding entries inconsistently; here we trust upstream.
function expandCatalog(raw: Record<string, unknown>[]): { id: string; name: string }[] {
  const seen = new Set<string>();
  const models: { id: string; name: string }[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const caps = m.capabilities as Record<string, unknown> | undefined;
    if (caps?.type !== "chat") continue;
    const policy = m.policy as Record<string, unknown> | undefined;
    if (policy && policy.state !== "enabled") continue;
    const id = m.id as string;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: (m.name as string) || id });
  }
  return models;
}

interface CopilotModelsOptions {
  forceRefresh?: boolean;
  log?: Logger;
  signal?: AbortSignal;
  onCredentialsRefreshed?: (data: Record<string, unknown>) => Promise<void>;
}

/**
 * Resolve the live Copilot model catalog for a connection.
 *
 * @param {object} credentials Connection record (accessToken, refreshToken,
 *   providerSpecificData {copilotToken, copilotTokenExpiresAt}).
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh] Bypass the per-credential cache.
 * @param {object}  [options.log] Logger.
 * @param {function} [options.onCredentialsRefreshed] Persist a refreshed
 *   Copilot token back to your store. Called with `{ copilotToken,
 *   copilotTokenExpiresAt }` whenever a 401 triggers a refresh.
 * @returns {Promise<{ models: object[] } | null>}
 */
export async function resolveCopilotModels(credentials: Credentials, options: CopilotModelsOptions = {}): Promise<{ models: { id: string; name: string }[] } | null> {
  const token = credentials?.providerSpecificData?.copilotToken || credentials?.accessToken;
  if (!token) {
    options.log?.debug?.("COPILOT_MODELS", "No copilotToken/accessToken; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { models: cached.models };
    }
  }

  let raw: Record<string, unknown>[];
  try {
    raw = await fetchCatalogRaw(token, options.signal);
  } catch (err: unknown) {
    const copilotErr = err as CopilotError;
    // A 401/403 means the Copilot token is stale — refresh from the GitHub
    // access token and retry once.
    if (copilotErr && (copilotErr.status === 401 || copilotErr.status === 403) && credentials.accessToken) {
      options.log?.info?.("COPILOT_MODELS", `Got ${copilotErr.status}; refreshing Copilot token`);
      const refreshed = await refreshCopilotToken(credentials.accessToken);
      if (refreshed?.token) {
        if (typeof options.onCredentialsRefreshed === "function") {
          try {
            await options.onCredentialsRefreshed({
              copilotToken: refreshed.token,
              copilotTokenExpiresAt: refreshed.expiresAt,
            });
          } catch (e: unknown) {
            options.log?.warn?.("COPILOT_MODELS", `onCredentialsRefreshed failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        try {
          raw = await fetchCatalogRaw(refreshed.token as string, options.signal);
        } catch (err2: unknown) {
          options.log?.warn?.("COPILOT_MODELS", `Retry after refresh failed: ${err2 instanceof Error ? err2.message : String(err2)}`);
          return null;
        }
      } else {
        options.log?.warn?.("COPILOT_MODELS", "Token refresh did not return a token");
        return null;
      }
    } else {
      options.log?.warn?.("COPILOT_MODELS", `Live model fetch failed: ${copilotErr?.message || copilotErr}`);
      return null;
    }
  }

  const models = expandCatalog(raw);
  if (!models.length) return null;

  catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
  return { models };
}

export function clearCopilotModelCache(): void {
  catalogCache.clear();
}
