// Background proactive OAuth token refresh â€” independent of inbound requests.
// Fail-open everywhere: tick errors and per-connection failures never kill the interval.

import * as log from "../utils/logger";
import { getRefreshLeadMs } from "@/lib/open-sse/services/tokenRefresh";
import { getCredentialExpiryMs } from "@/lib/open-sse/services/oauthCredentialManager";

/** Refresh when expiry is within 30 minutes (or the provider on-request lead, whichever larger). */
export const BACKGROUND_REFRESH_LEAD_MS: number = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS: number = 5 * 60 * 1000;
const INITIAL_DELAY_MS: number = 10 * 1000;

let started: boolean = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let initialTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let tickRunning: boolean = false;

function isTruthyEnv(value: string | undefined | null): boolean {
  if (value == null || value === "") return false;
  const v: string = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isNonServerRuntime(): boolean {
  if (typeof window !== "undefined") return true;
  const phase: string = process.env.NEXT_PHASE || "";
  if (
    phase === "phase-production-build" ||
    phase === "phase-export" ||
    phase === "phase-static"
  ) {
    return true;
  }
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

interface Connection {
  id?: string;
  provider?: string;
  authType?: string;
  refreshToken?: string;
  [key: string]: unknown;
}

/**
 * Pure selection: OAuth connections with a refreshToken whose access token
 * expires within max(provider on-request lead, BACKGROUND_REFRESH_LEAD_MS).
 */
export function selectConnectionsNeedingRefresh(connections: Connection[], nowMs: number = Date.now()): Connection[] {
  if (!Array.isArray(connections) || connections.length === 0) return [];

  const out: Connection[] = [];
  for (const conn of connections) {
    if (!conn) continue;

    const authType: string = String(conn.authType || "").toLowerCase().replace(/_/g, "");
    if (authType !== "oauth") continue;
    if (!conn.refreshToken) continue;

    const expiresAtMs: number | null = getCredentialExpiryMs(conn);
    if (expiresAtMs === null) continue;

    const providerLead: number = getRefreshLeadMs(conn.provider!);
    const leadMs: number = Math.max(
      Number.isFinite(providerLead) ? providerLead : 0,
      BACKGROUND_REFRESH_LEAD_MS
    );

    if (expiresAtMs - nowMs < leadMs) {
      out.push(conn);
    }
  }
  return out;
}

async function loadActiveConnections(): Promise<Connection[]> {
  const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo");
  return getProviderConnections({ isActive: true });
}

async function refreshOne(connection: Connection): Promise<unknown> {
  const { checkAndRefreshToken } = await import("./tokenRefresh");
  return checkAndRefreshToken(connection.provider!, connection, { force: true });
}

interface TickDeps {
  loadConnections?: () => Promise<Connection[]>;
  refreshConnection?: (conn: Connection) => Promise<unknown>;
}

/**
 * One scheduler tick. Fail-open at top level and per connection.
 */
export async function runBackgroundTokenRefreshTick(deps: TickDeps = {}): Promise<void> {
  if (tickRunning) {
    log.debug("BG_TOKEN_REFRESH", "Tick already running, skip");
    return;
  }
  tickRunning = true;
  try {
    const load: () => Promise<Connection[]> = deps.loadConnections || loadActiveConnections;
    const refresh: (conn: Connection) => Promise<unknown> = deps.refreshConnection || refreshOne;

    const connections: Connection[] = await load();
    const due: Connection[] = selectConnectionsNeedingRefresh(connections, Date.now());

    if (due.length === 0) {
      log.debug("BG_TOKEN_REFRESH", "No connections due for refresh", {
        active: Array.isArray(connections) ? connections.length : 0,
      });
      return;
    }

    log.info("BG_TOKEN_REFRESH", "Refreshing due OAuth connections", {
      due: due.length,
      ids: due.map((c: Connection) => c.id).filter(Boolean),
    });

    await Promise.allSettled(
      due.map(async (conn: Connection) => {
        try {
          await refresh(conn);
          log.info("BG_TOKEN_REFRESH", "Connection refresh finished", {
            id: conn.id,
            provider: conn.provider,
          });
        } catch (err: unknown) {
          log.warn("BG_TOKEN_REFRESH", "Connection refresh failed (swallowed)", {
            id: conn?.id,
            provider: conn?.provider,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  } catch (err: unknown) {
    log.warn("BG_TOKEN_REFRESH", "Tick failed (swallowed)", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    tickRunning = false;
  }
}

interface StartOptions {
  intervalMs?: number;
}

/**
 * Start the background interval. Safe to call multiple times (no-op if already started).
 * @returns true if started this call
 */
export function startBackgroundTokenRefresh({ intervalMs }: StartOptions = {}): boolean {
  if (started) return false;
  if (isTruthyEnv(process.env.DISABLE_BACKGROUND_TOKEN_REFRESH)) {
    log.info("BG_TOKEN_REFRESH", "Disabled via DISABLE_BACKGROUND_TOKEN_REFRESH");
    return false;
  }
  if (isNonServerRuntime()) {
    log.debug("BG_TOKEN_REFRESH", "Skip start outside long-running server runtime");
    return false;
  }

  started = true;
  const period: number = Number.isFinite(intervalMs!) && intervalMs! > 0 ? intervalMs! : DEFAULT_INTERVAL_MS;

  const safeTick = (): void => {
    runBackgroundTokenRefreshTick().catch((err: Error) => {
      log.warn("BG_TOKEN_REFRESH", "Unhandled tick rejection (swallowed)", {
        error: err?.message ?? String(err),
      });
    });
  };

  initialTimeoutHandle = setTimeout(safeTick, INITIAL_DELAY_MS);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle.unref) intervalHandle.unref();

  log.info("BG_TOKEN_REFRESH", "Scheduler started", {
    intervalMs: period,
    initialDelayMs: INITIAL_DELAY_MS,
    leadMs: BACKGROUND_REFRESH_LEAD_MS,
  });
  return true;
}

export function stopBackgroundTokenRefresh(): void {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (started) {
    started = false;
    log.info("BG_TOKEN_REFRESH", "Scheduler stopped");
  }
}
