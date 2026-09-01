// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "@/server/llm-gateway/engine/utils/proxyFetch";

import { generatePKCE } from "../utils/pkce";
import { extractCodexAccountInfo, fetchKiroProfileArn } from "../providerHelpers";

import claude from "./claude";
import codex from "./codex";
import xai from "./xai";
import grokCli from "./grok-cli";
import geminiCli from "./gemini-cli";
import antigravity from "./antigravity";
import iflow from "./iflow";
import qoder from "./qoder";
import github from "./github";
import kiro from "./kiro";
import cursor from "./cursor";
import kimi from "./kimi";
import kilocode from "./kilocode";
import cline from "./cline";
import clinepass from "./clinepass";
import gitlab from "./gitlab";
import codebuddyCn from "./codebuddy-cn";
import codebuddyIntl from "./codebuddy-intl";
import kimchi from "./kimchi";
import trae from "./trae";
import windsurf from "./windsurf";
import zed from "./zed";
import gheCopilot from "./ghe-copilot";
import amazonQ from "./amazon-q";
import agy from "./agy";
import openference from "./openference";

interface ProviderHandler {
  config: Record<string, unknown>;
  flowType: string;
  fixedPort?: number;
  callbackPath?: string;
  pkceVerifierBytes?: number;
  prepareConfig?: (config: Record<string, unknown>, meta: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  buildAuthUrl: (config: Record<string, unknown>, redirectUri: string, state: string, codeChallenge?: string, meta?: Record<string, unknown>) => string;
  exchangeToken: (config: Record<string, unknown>, code: string, redirectUri: string, codeVerifier: string, state: string, meta: Record<string, unknown>) => Promise<Record<string, unknown>>;
  postExchange?: (tokens: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  mapTokens: (tokens: Record<string, unknown>, extra: Record<string, unknown> | null) => Record<string, unknown>;
  requestDeviceCode?: (config: Record<string, unknown>, codeChallenge: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  pollToken?: (config: Record<string, unknown>, deviceCode: string, codeVerifier: string, extraData: Record<string, unknown>) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
}

// Provider configurations
const PROVIDERS: Record<string, ProviderHandler> = {
  claude,
  codex,
  xai,
  "grok-cli": grokCli,
  "gemini-cli": geminiCli,
  antigravity,
  iflow,
  qoder,
  github,
  kiro,
  cursor,
  kimi,
  kilocode,
  cline,
  clinepass,
  gitlab,
  "codebuddy-cn": codebuddyCn,
  "codebuddy-intl": codebuddyIntl,
  kimchi,
  trae,
  windsurf,
  zed,
  "ghe-copilot": gheCopilot,
  "amazon-q": amazonQ,
  agy,
  openference,
} as unknown as Record<string, ProviderHandler>;

// Re-export helpers that other files import from this path
export { extractCodexAccountInfo };

/**
 * Get provider handler
 */
export function getProvider(name: string): ProviderHandler {
  // Legacy kimi-coding â†’ kimi (dual-auth merge)
  const key: string = name === "kimi-coding" ? "kimi" : name;
  const provider: ProviderHandler | undefined = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get all provider names
 */

interface AuthData {
  authUrl: string | null;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  flowType: string;
  fixedPort?: number;
  callbackPath: string;
}

/**
 * Generate auth data for a provider
 */
export async function generateAuthData(providerName: string, redirectUri: string, meta?: Record<string, unknown>): Promise<AuthData> {
  const provider: ProviderHandler = getProvider(providerName);
  const config: Record<string, unknown> = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier: pkceVerifier, codeChallenge, state: pkceState } = generatePKCE(provider.pkceVerifierBytes);
  // Trae uses loginTraceID (set by prepareConfig) as the callback matcher, not PKCE state.
  const state: string = (config.loginTraceID as string) || pkceState;
  // Zed: codeVerifier carries the encoded RSA private key (from prepareConfig), not a PKCE verifier.
  const codeVerifier: string = (config.privateKeyVerifier as string) || pkceVerifier;

  let authUrl: string | null;
  if (provider.flowType === "device_code") {
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

/**
 * Exchange code for tokens
 */
export async function exchangeTokens(providerName: string, code: string, redirectUri: string, codeVerifier: string, state: string, meta?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const provider: ProviderHandler = getProvider(providerName);
  const config: Record<string, unknown> = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens: Record<string, unknown> = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra: Record<string, unknown> | null = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Request device code (for device_code flow)
 */
export async function requestDeviceCode(providerName: string, codeChallenge: string, options?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const provider: ProviderHandler = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await provider.requestDeviceCode!(provider.config, codeChallenge, options || {});
}

interface PollResult {
  success: boolean;
  tokens?: Record<string, unknown>;
  error?: string;
  errorDescription?: string;
  pending?: boolean;
}

/**
 * Poll for token (for device_code flow)
 */
export async function pollForToken(providerName: string, deviceCode: string, codeVerifier: string, extraData?: Record<string, unknown>): Promise<PollResult> {
  const provider: ProviderHandler = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result: { ok: boolean; data: Record<string, unknown> } = await provider.pollToken!(provider.config, deviceCode, codeVerifier, extraData || {});

  if (result.ok) {
    if (result.data.access_token) {
      let extra: Record<string, unknown> | null = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens: Record<string, unknown> = provider.mapTokens(result.data, extra);
      // Kiro IDC/Builder-ID tokens lack profileArn; resolve it to avoid 403
      if (providerName === "kiro" && !(tokens.providerSpecificData as Record<string, unknown>)?.profileArn) {
        const profileArn: string | null = await fetchKiroProfileArn(tokens.accessToken as string);
        if (profileArn) (tokens.providerSpecificData as Record<string, unknown>).profileArn = profileArn;
      }
      return { success: true, tokens };
    } else {
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        return {
          success: false,
          error: result.data.error as string,
          errorDescription: (result.data.error_description as string) || (result.data.message as string),
          pending: result.data.error === 'authorization_pending'
        };
      } else {
        return {
          success: false,
          error: (result.data.error as string) || 'no_access_token',
          errorDescription: (result.data.error_description as string) || (result.data.message as string) || 'No access token received'
        };
      }
    }
  }

  return { success: false, error: result.data.error as string, errorDescription: result.data.error_description as string };
}

// Run-once guard across the process lifetime
let codexBackfillDone: boolean = false;

interface CodexConnection {
  id: string;
  provider: string;
  authType: string;
  idToken?: string;
  email?: string;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}

// Backfill email + chatgpt account info for existing codex OAuth connections missing them
export async function backfillCodexEmails(): Promise<void> {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/db/repos/connectionsRepo");
    const connections: CodexConnection[] = await getProviderConnections() as CodexConnection[];
    const targets: CodexConnection[] = connections.filter((c: CodexConnection) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail: boolean = !!c.email;
      const hasAccountInfo: boolean = !!(c.providerSpecificData as Record<string, unknown>)?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken!);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch: Record<string, unknown> = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err: unknown) {
    codexBackfillDone = false;
    console.error("backfillCodexEmails failed:", (err as Error)?.message || err);
  }
}
