// Quota auto-ping scheduler: warms 5h windows by sending tiny opt-in requests right after reset.
import { getSettings, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getClaudeUsage } from "@/lib/open-sse/services/usage/claude";
import { getCodexUsage } from "@/lib/open-sse/services/usage/codex";
import { getExecutor } from "@/lib/open-sse/executors/index";
import { CLAUDE_CLI_SPOOF_HEADERS } from "@/lib/open-sse/providers/shared";
import { proxyAwareFetch } from "@/lib/open-sse/utils/proxyFetch";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuotaInfo {
  unlimited?: boolean;
  remaining?: number | string;
  used?: number | string;
  total?: number | string;
  resetAt?: string;
}

export interface UsageResult {
  quotas?: Record<string, QuotaInfo>;
}

export interface ProviderConnection {
  id: string;
  provider: string;
  authType: string;
  accessToken: string;
  providerSpecificData?: Record<string, unknown>;
  lastPingAt?: string;
  lastPingedResetAt?: string;
  lastPingedResetKey?: string;
  [key: string]: unknown;
}

export interface ProviderConfig {
  settingsKey: string;
  quotaKey: string;
  pingModel: string;
  pingText: string;
  pingMaxTokens?: number;
  pingWhenResetAtSlides?: boolean;
  resetAtDriftMs?: number;
  minPingIntervalMs?: number;
  skipWhenBlockingQuotaExhausted?: boolean;
  pingInstructions?: string;
  pingReasoningEffort?: string;
}

export interface ProxyOptions {
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
  vercelRelayUrl: string;
  strictProxy: boolean;
}

export interface ProxyConfig {
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
  vercelRelayUrl?: string;
}

export interface ProviderHandler {
  getUsage: (accessToken: string, proxyOptions: ProxyOptions) => Promise<UsageResult>;
  sendPing: (connection: ProviderConnection, providerConfig: ProviderConfig, proxyOptions: ProxyOptions, deps: Deps) => Promise<boolean>;
}

export interface Deps {
  getSettings: typeof getSettings;
  getProviderConnections: typeof getProviderConnections;
  updateProviderConnection: typeof updateProviderConnection;
  resolveConnectionProxyConfig: (data: Record<string, unknown>) => Promise<ProxyConfig>;
  refreshAndUpdateCredentials: typeof refreshAndUpdateCredentials;
  proxyAwareFetch: typeof proxyAwareFetch;
  getExecutor: typeof getExecutor;
}

export interface AutoPingState {
  interval: ReturnType<typeof setInterval> | null;
  running: boolean;
  resetCache: Record<string, string>;
  failureCache: Record<string, number>;
}

interface Settings {
  [key: string]: unknown;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const C = QUOTA_AUTOPING_CONFIG;
const CLAUDE_PING_URL: string = "https://api.anthropic.com/v1/messages?beta=true";

interface AutoPingSettings {
  connections?: Record<string, boolean>;
  [key: string]: unknown;
}

const providerHandlers: Record<string, ProviderHandler> = {
  claude: {
    getUsage: getClaudeUsage as unknown as (accessToken: string, proxyOptions: ProxyOptions) => Promise<UsageResult>,
    sendPing: sendClaudePing,
  },
  codex: {
    getUsage: getCodexUsage as unknown as (accessToken: string, proxyOptions: ProxyOptions) => Promise<UsageResult>,
    sendPing: sendCodexPing,
  },
};

declare global {
  // eslint-disable-next-line no-var
  var __quotaAutoPing: AutoPingState | undefined;
}

// Survive Next.js hot reload and keep one scheduler per server process.
const g: AutoPingState = (global.__quotaAutoPing ??= {
  interval: null,
  running: false,
  resetCache: {},
  failureCache: {},
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cacheKey(provider: string, connectionId: string): string {
  return `${provider}:${connectionId}`;
}

function normalizeResetKey(resetAt: string): string {
  const ms: number = new Date(resetAt).getTime();
  if (!Number.isFinite(ms)) return resetAt;
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

function getResetDriftMs(previousResetAt: string, nextResetAt: string): number {
  const previousMs: number = new Date(previousResetAt).getTime();
  const nextMs: number = new Date(nextResetAt).getTime();
  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) return 0;
  return nextMs - previousMs;
}

function toFiniteNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed: number = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isQuotaExhausted(quota: QuotaInfo | undefined): boolean {
  if (!quota || quota.unlimited === true) return false;
  const remaining: number | null = toFiniteNumber(quota.remaining);
  if (remaining !== null) return remaining <= 0;

  const used: number | null = toFiniteNumber(quota.used);
  const total: number | null = toFiniteNumber(quota.total);
  return total !== null && total > 0 && used !== null && used >= total;
}

function wasPingedRecently(connection: ProviderConnection, intervalMs: number | undefined, nowMs: number = Date.now()): boolean {
  if (!intervalMs) return false;
  const lastPingAtMs: number = new Date(connection.lastPingAt!).getTime();
  return Number.isFinite(lastPingAtMs) && nowMs - lastPingAtMs < intervalMs;
}

function isBlockingQuotaName(name: string, sessionKey: string): boolean {
  if (name === sessionKey) return false;
  return !String(name).toLowerCase().includes("session");
}

function hasExhaustedBlockingQuota(quotas: Record<string, QuotaInfo>, sessionKey: string): boolean {
  return Object.entries(quotas || {}).some(([name, quota]) => isBlockingQuotaName(name, sessionKey) && isQuotaExhausted(quota));
}

function shouldPingForReset(providerConfig: ProviderConfig, cachedReset: string | undefined, resetAt: string, now: number): boolean {
  if (providerConfig.pingWhenResetAtSlides) {
    return Boolean(cachedReset) && getResetDriftMs(cachedReset!, resetAt) >= (providerConfig.resetAtDriftMs || 0);
  }

  const resetMs: number = new Date(resetAt).getTime();
  return Number.isFinite(resetMs) && now >= resetMs - C.pingLeadMs;
}

function buildProxyOptions(cfg: ProxyConfig): ProxyOptions {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

async function sendClaudePing(connection: ProviderConnection, providerConfig: ProviderConfig, proxyOptions: ProxyOptions, deps: Deps): Promise<boolean> {
  const res = (await deps.proxyAwareFetch(CLAUDE_PING_URL, {
    method: "POST",
    headers: {
      ...CLAUDE_CLI_SPOOF_HEADERS,
      "Authorization": `Bearer ${connection.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: providerConfig.pingModel,
      max_tokens: providerConfig.pingMaxTokens,
      messages: [{ role: "user", content: providerConfig.pingText }],
    }),
  }, proxyOptions as unknown as null)) as Response;
  return res.ok;
}

function buildCodexPingInput(text: string): Array<{ type: string; role: string; content: Array<{ type: string; text: string }> }> {
  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}

async function drainResponseBody(response: unknown): Promise<void> {
  const res = response as { text?: () => Promise<string>; body?: { getReader?: () => ReadableStreamDefaultReader<unknown> } } | null;
  if (typeof res?.text === "function") {
    await res.text();
    return;
  }

  const reader = res?.body?.getReader?.();
  if (!reader) return;

  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function sendCodexPing(connection: ProviderConnection, providerConfig: ProviderConfig, proxyOptions: ProxyOptions, deps: Deps): Promise<boolean> {
  const executor = deps.getExecutor("codex");
  const { response } = await executor.execute({
    model: providerConfig.pingModel,
    stream: true,
    credentials: {
      accessToken: connection.accessToken,
      connectionId: connection.id,
      providerSpecificData: connection.providerSpecificData,
    },
    proxyOptions,
    log: console,
    body: {
      model: providerConfig.pingModel,
      input: buildCodexPingInput(providerConfig.pingText),
      instructions: providerConfig.pingInstructions,
      reasoning: providerConfig.pingReasoningEffort
        ? { effort: providerConfig.pingReasoningEffort, summary: "auto" }
        : undefined,
      store: false,
      stream: true,
    },
  });
  if (!response.ok) {
    try { await (response as { body?: { cancel?: () => Promise<void> } }).body?.cancel?.(); } catch { /* noop */ }
    return false;
  }

  // Codex only starts the 5h window after the streaming response completes.
  await drainResponseBody(response);
  return true;
}

function shouldSkipAfterFailure(state: AutoPingState, key: string, nowMs: number = Date.now()): boolean {
  const failedAt: number | undefined = state.failureCache[key];
  return failedAt !== undefined && nowMs - failedAt < C.failureCooldownMs;
}

async function pingConnection(conn: ProviderConnection, provider: string, providerConfig: ProviderConfig, handler: ProviderHandler, deps: Deps, state: AutoPingState = g): Promise<void> {
  const key: string = cacheKey(provider, conn.id);

  // resetAt is stable for time-based windows; Codex polls every tick because inactive windows slide forward.
  const cachedReset: string | undefined = state.resetCache[key];
  if (!providerConfig.pingWhenResetAtSlides && cachedReset && Date.now() < new Date(cachedReset).getTime() - C.refreshAheadMs) return;

  // Avoid hammering provider auth/quota endpoints if a ping failed recently.
  if (shouldSkipAfterFailure(state, key)) return;

  const proxyCfg: ProxyConfig = await deps.resolveConnectionProxyConfig(conn.providerSpecificData || {});
  const proxyOptions: ProxyOptions = buildProxyOptions(proxyCfg);

  let connection: ProviderConnection = conn;
  try {
    const r = await deps.refreshAndUpdateCredentials(connection, false, proxyOptions as unknown as null);
    connection = r.connection;
  } catch (e: unknown) {
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${conn.id}: refresh failed: ${(e as Error).message}`);
    return;
  }

  const usage: UsageResult = await handler.getUsage(connection.accessToken, proxyOptions);
  const quotas: Record<string, QuotaInfo> = usage?.quotas || {};
  const quota: QuotaInfo | undefined = quotas?.[providerConfig.quotaKey];
  const resetAt: string | undefined = quota?.resetAt;
  if (!resetAt) return;

  state.resetCache[key] = resetAt;

  if (providerConfig.skipWhenBlockingQuotaExhausted && hasExhaustedBlockingQuota(quotas, providerConfig.quotaKey)) return;
  if (isQuotaExhausted(quota)) return;

  const now: number = Date.now();
  const resetKey: string = normalizeResetKey(resetAt);
  const lastPingedResetKey: string = connection.lastPingedResetKey || normalizeResetKey(connection.lastPingedResetAt!);

  // Claude waits for reset. Codex pings only when resetAt slides, which means the 5h window is inactive.
  if (!shouldPingForReset(providerConfig, cachedReset, resetAt, now)) return;
  if (wasPingedRecently(connection, providerConfig.minPingIntervalMs, now)) return;
  if (lastPingedResetKey === resetKey) return;

  const ok: boolean = await handler.sendPing(connection, providerConfig, proxyOptions, deps);
  if (!ok) {
    // Do not mark reset as pinged unless upstream accepted the tiny request.
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${connection.id}: ping failed (reset ${resetAt})`);
    return;
  }

  delete state.failureCache[key];
  await deps.updateProviderConnection(connection.id, {
    lastPingedResetAt: resetAt,
    lastPingedResetKey: resetKey,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${provider}:${connection.id}: ping sent (reset ${resetAt})`);
}

function createDefaultDeps(): Deps {
  return {
    getSettings,
    getProviderConnections,
    updateProviderConnection,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
    proxyAwareFetch,
    getExecutor,
  };
}

export async function runQuotaAutoPingTick(deps: Deps = createDefaultDeps(), state: AutoPingState = g): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const settings: Settings = await deps.getSettings();

    for (const [provider, providerConfig] of Object.entries(C.providers)) {
      const handler: ProviderHandler | undefined = providerHandlers[provider];
      if (!handler) continue;

      const enabledMap: Record<string, boolean> = (settings?.[providerConfig.settingsKey] as AutoPingSettings | undefined)?.connections || {};
      if (Object.keys(enabledMap).length === 0) continue;

      const conns = await deps.getProviderConnections({ provider, isActive: true }) as unknown as ProviderConnection[];
      const targets: ProviderConnection[] = conns.filter((conn: ProviderConnection) => conn.authType === "oauth" && enabledMap[conn.id] === true);
      for (const conn of targets) {
        try {
          await pingConnection(conn, provider, providerConfig as ProviderConfig, handler, deps, state);
        } catch (e: unknown) {
          state.failureCache[cacheKey(provider, conn.id)] = Date.now();
          console.warn(`[AutoPing] ${provider}:${conn.id}: ${(e as Error).message}`);
        }
      }
    }
  } catch (e: unknown) {
    console.warn("[AutoPing] tick error:", (e as Error).message);
  } finally {
    state.running = false;
  }
}

export function startQuotaAutoPing(): void {
  if (g.interval) return;
  console.log("[AutoPing] scheduler started");
  runQuotaAutoPingTick().catch(() => {});
  g.interval = setInterval(() => { runQuotaAutoPingTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopQuotaAutoPing(): void {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.error("[AutoPing] scheduler stopped");
}

export function configureQuotaAutoPing(settings: Settings): void {
  const enabled: boolean = Object.values(C.providers).some((providerConfig) =>
    Object.values((settings?.[providerConfig.settingsKey] as AutoPingSettings | undefined)?.connections || {}).some(Boolean)
  );
  if (enabled) startQuotaAutoPing();
  else stopQuotaAutoPing();
}
