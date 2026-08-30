import { createHash } from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

/**
 * GitHubCopilotExecutor — token exchange + cache for GitHub Copilot API.
 *
 * Flow:
 *   1. User provides a GitHub OAuth token (gho_/ghu_/ghp_/ghs_/github_pat_...)
 *   2. We exchange it for a short-lived Copilot token (tid=...) via
 *      GET https://api.github.com/copilot_internal/v2/token
 *   3. Cache the result keyed by SHA-256 of the GitHub token; TTL = expires_at - 2min
 *   4. If user already provides a tid=... token, pass through without exchange
 *
 * Every request to api.githubcopilot.com includes mandatory identity headers.
 */

const TOKEN_ENDPOINT = "https://api.github.com/copilot_internal/v2/token";
const EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes before expiry
const GITHUB_TOKEN_RE = /^(gho_|ghu_|ghp_|ghs_|github_pat_)/;
const RENAME_MAX_TOKENS_RE = /^(o\d|copilot\/gpt-5)/i;

const COPILOT_HEADERS: Record<string, string> = {
  "Copilot-Integration-Id": "vscode-chat",
  "Editor-Plugin-Version": "copilot/1.300.0",
  "Editor-Version": "vscode/1.104.0",
};

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** In-memory cache keyed by SHA-256 of the raw GitHub token. */
const tokenCache = new Map<string, CachedToken>();

/** In-flight promises to prevent cache stampede on concurrent calls. */
const inflight = new Map<string, Promise<CachedToken>>();

function cacheKey(githubToken: string): string {
  return createHash("sha256").update(githubToken).digest("base64url");
}

function evictExpired(now: number): void {
  for (const [key, entry] of tokenCache) {
    if (now >= entry.expiresAt) tokenCache.delete(key);
  }
}

function isGithubOAuthToken(token: string): boolean {
  return GITHUB_TOKEN_RE.test(token);
}

async function exchangeToken(githubToken: string): Promise<CachedToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401
      ? "Token invalid or expired. Generate a new token at https://github.com/settings/tokens (requires Copilot subscription)."
      : `HTTP ${res.status}`;
    throw new Error(`Copilot token exchange failed: ${hint} — ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { token?: string; expires_at?: number };
  if (!data.token || !data.expires_at) {
    throw new Error("Invalid Copilot token exchange response: missing token or expires_at");
  }

  return { token: data.token, expiresAt: data.expires_at * 1000 };
}

/**
 * Resolve a Copilot credential: GitHub long-lived tokens are exchanged
 * (with cache) for a short-lived Copilot token; tid=... tokens pass through.
 */
async function resolveCopilotToken(rawToken: string): Promise<string> {
  if (!isGithubOAuthToken(rawToken)) return rawToken;

  const key = cacheKey(rawToken);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && now < cached.expiresAt - EXPIRY_BUFFER_MS) {
    return cached.token;
  }

  evictExpired(now);

  let promise = inflight.get(key);
  if (!promise) {
    promise = exchangeToken(rawToken).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
  }

  const result = await promise;
  tokenCache.set(key, result);
  return result.token;
}

export class GithubCopilotExecutor extends BaseExecutor {
  constructor() {
    super("github-copilot", PROVIDERS["github-copilot"] || {});
  }

  buildHeaders(credentials: Credentials, stream = true) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...COPILOT_HEADERS,
    };

    // Auth will be set after token resolution in execute()
    // For now, set a placeholder that buildHeaders can provide
    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, _credentials?: Credentials) {
    // Rename max_tokens → max_completion_tokens for GPT-5+ and o-series models
    if (RENAME_MAX_TOKENS_RE.test(model) && body.max_tokens !== undefined) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    return body;
  }

  async execute(opts: import("./base").ExecuteArgs) {
    const rawToken = opts.credentials?.apiKey || opts.credentials?.accessToken || "";
    if (!rawToken) {
      throw new Error("GitHub Copilot requires a GitHub token (gho_/ghu_/ghp_/ghs_/github_pat_...) or a Copilot token (tid=...).");
    }

    // Resolve token: exchange GitHub token for Copilot token, or pass through tid=...
    const copilotToken = await resolveCopilotToken(rawToken);

    // Inject resolved token into credentials for buildHeaders
    const patchedCredentials: Credentials = {
      ...opts.credentials,
      accessToken: copilotToken,
    };

    return super.execute({ ...opts, credentials: patchedCredentials });
  }
}

export default GithubCopilotExecutor;
