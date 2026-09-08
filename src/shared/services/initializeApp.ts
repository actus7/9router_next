import os from "os";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { cleanupProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { forEachTenant, listTenantIds } from "@/lib/db/tenants";
import { withTenant } from "@/lib/db/tenant";
import {
  enableTunnel, enableTailscale,
  getTunnelService, getTailscaleService, setTunnelUnexpectedExitCallback,
  killCloudflared, isCloudflaredRunning, ensureCloudflared,
  isTailscaleRunning, isTailscaleRunningStrict, isDaemonAlive, startFunnel,
  checkInternet,
  RESTART_COOLDOWN_MS, NETWORK_SETTLE_MS,
  WATCHDOG_INTERVAL_MS, NETWORK_CHECK_INTERVAL_MS, VIRTUAL_IFACE_REGEX,
} from "@/lib/tunnel";
import { killAllBridges } from "@/lib/mcp/stdioSseBridge";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppSingleton {
  initialized: boolean;
  signalHandlersRegistered: boolean;
  watchdogInterval: ReturnType<typeof setInterval> | null;
  networkMonitorInterval: ReturnType<typeof setInterval> | null;
  lastNetworkFingerprint: string | null;
  lastWatchdogTick: number;
  lastOnline: boolean | null;
  tunnelAutoResumed: boolean;
  tailscaleAutoResumed: boolean;
  /**
   * The account whose settings the tunnel and Tailscale processes were started
   * from, for this process.
   *
   * There is one `cloudflared` per machine but one `tunnelEnabled` row per
   * account, so a watchdog restart has to know which account's settings it is
   * acting on. It is whoever turned it on — at startup on a single-account
   * install, or the account that called the enable route. Null means nobody
   * did, and the watchdog has nothing to restart.
   */
  tunnelOwner: string | null;
  tailscaleOwner: string | null;
}

interface TunnelService {
  cancelToken: { cancelled: boolean };
  spawnInProgress: boolean;
  lastRestartAt: number;
  activeLocalPort?: number | null;
}

interface TailscaleService {
  cancelToken: { cancelled: boolean };
  spawnInProgress: boolean;
  lastRestartAt: number;
  activeLocalPort?: number | null;
}

interface Settings {
  tunnelEnabled?: boolean;
  tailscaleEnabled?: boolean;
  claudeAutoPing?: AutoPingSettings;
  codexAutoPing?: AutoPingSettings;
  [key: string]: unknown;
}

interface AutoPingSettings {
  connections?: Record<string, boolean>;
}

process.setMaxListeners(20);

// Defer heavy startup work so the first HTTP request (login → dashboard) isn't
// starved by DB cleanup, cloudflared download, lsof/DNS probes and OAuth pings.
const STARTUP_DEFER_MS: number = 3000;

declare global {
  var __appSingleton: AppSingleton | undefined;
}

// Survive Next.js hot reload
const g: AppSingleton = global.__appSingleton ??= {
  initialized: false,
  signalHandlersRegistered: false,
  watchdogInterval: null,
  networkMonitorInterval: null,
  lastNetworkFingerprint: null,
  lastWatchdogTick: Date.now(),
  lastOnline: null,
  tunnelAutoResumed: false,
  tailscaleAutoResumed: false,
  tunnelOwner: null,
  tailscaleOwner: null,
};

export async function initializeApp(): Promise<void> {
  if (g.initialized) return;
  g.initialized = true;
  try {
    // Register cleanup + exit-respawn callback immediately so signals and
    // unexpected cloudflared exits are handled even during the deferred window.
    if (!g.signalHandlersRegistered) {
      const cleanup = (): void => {
        try { killAllBridges(); } catch { /* best effort */ }
        killCloudflared(0);
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      g.signalHandlersRegistered = true;
    }

    setTunnelUnexpectedExitCallback(() => {
      safeRestartTunnel("unexpected-exit").catch(() => {});
    });

    // Defer the heavy work — nothing here blocks incoming requests.
    setTimeout(() => {
      runHeavyStartup().catch((e: Error) => console.error("[InitApp] deferred startup failed:", e.message));
    }, STARTUP_DEFER_MS);
  } catch (error) {
    g.initialized = false;
    console.error("[InitApp] Error:", error);
  }
}

async function runHeavyStartup(): Promise<void> {
  await forEachTenant(async () => { await cleanupProviderConnections(); });

  await resumeSingleTenantProcesses();

  // Both schedulers loop over accounts themselves, so they start unconditionally
  // and decide per account what to do.
  import("@/server/services/quotaAutoPing")
    .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
    .catch((e: Error) => console.error("[AutoPing] scheduler start failed:", e.message));

  // Proactive OAuth token refresh (e.g. grok-cli ~6h TTL). Module is idempotent
  // and also started from custom-server.js when that entry is used.
  import("@/server/llm-gateway/auth")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((e: Error) => console.error("[BackgroundTokenRefresh] scheduler start failed:", e.message));
}

/**
 * Resume the tunnel and Tailscale from stored settings, but only on a
 * single-account instance.
 *
 * `cloudflared` and `tailscaled` are one process per machine, while
 * `tunnelEnabled` is now a row per account. On a self-hosted install with one
 * account those are the same thing and behaviour is unchanged. With several,
 * "is the tunnel on" has no single answer — resuming from whichever account
 * happened to be enumerated last would hand one account's tunnel URL to
 * everyone — so it stays off and says so, and an operator who wants it enables
 * it explicitly from the dashboard.
 */
async function resumeSingleTenantProcesses(): Promise<void> {
  const tenants: string[] = await listTenantIds();
  if (tenants.length !== 1) {
    if (tenants.length > 1) {
      console.log(`[InitApp] ${tenants.length} accounts: skipping tunnel/Tailscale auto-resume (one process, no single owner)`);
    }
    return;
  }

  await withTenant(tenants[0]!, async () => {
    const settings: Settings = await getSettings();

    if (settings.tunnelEnabled && !g.tunnelAutoResumed) {
      g.tunnelAutoResumed = true;
      g.tunnelOwner = tenants[0]!;
      console.log("[InitApp] Tunnel was enabled, auto-resuming...");
      safeRestartTunnel("startup").catch((e: Error) => console.error("[InitApp] Tunnel resume failed:", e.message));
    }

    if (settings.tailscaleEnabled && !g.tailscaleAutoResumed) {
      g.tailscaleAutoResumed = true;
      g.tailscaleOwner = tenants[0]!;
      console.log("[InitApp] Tailscale was enabled, auto-resuming...");
      safeRestartTailscale("startup").catch((e: Error) => console.error("[InitApp] Tailscale resume failed:", e.message));
    }

    if (settings.tunnelEnabled) ensureCloudflared().catch(() => {});

    configureTunnelMonitoring(settings);
  });
}


// Cooldown only applies to repeating watchdog ticks (anti hammer-loop).
// Network/exit events are one-shot transitions → bypass to recover fast.
const FORCE_RESTART_REASONS: RegExp = /^(startup|netchange|sleep|sleep\+netchange|online|unexpected-exit)$/;

// ─── Safe restart (4 guards: spawn / cooldown / alive / internet) ────────────

async function safeRestartTunnel(reason: string): Promise<void> {
  const owner: string | null = g.tunnelOwner;
  if (!owner) return;
  return withTenant(owner, () => safeRestartTunnelForOwner(reason));
}

async function safeRestartTunnelForOwner(reason: string): Promise<void> {
  const svc: TunnelService = getTunnelService();
  const settings: Settings = await getSettings();
  if (!settings.tunnelEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  const force: boolean = FORCE_RESTART_REASONS.test(reason);

  // Process alive = trust cloudflared (self-reconnects via --retries 99, keeps same URL).
  // Killing a live process on network change drops the tunnel and rotates the quick-tunnel URL.
  if (isCloudflaredRunning()) return;

  if (!force && Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) {
    console.log(`[Tunnel] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await checkInternet()) return;

  console.log(`[Tunnel] safeRestart (${reason}) — tunnel unreachable${force ? " [force]" : ""}`);
  try {
    await enableTunnel();
    svc.lastRestartAt = Date.now();
    console.log("[Tunnel] restart success");
  } catch (err: unknown) {
    if (!/cloudflared killed|tunnel cancelled/.test((err as Error).message)) {
      console.error("[Tunnel] restart failed:", (err as Error).message);
    }
  }
}

async function safeRestartTailscale(reason: string): Promise<void> {
  const owner: string | null = g.tailscaleOwner;
  if (!owner) return;
  return withTenant(owner, () => safeRestartTailscaleForOwner(reason));
}

async function safeRestartTailscaleForOwner(reason: string): Promise<void> {
  const svc: TailscaleService = getTailscaleService();
  const settings: Settings = await getSettings();
  if (!settings.tailscaleEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  // Tailscale daemon is OS-level with built-in reconnect; trust it when running (even on netchange).
  // Startup uses strict probe — cached state is cold after process/dev reload.
  const running: boolean = reason === "startup" ? await isTailscaleRunningStrict() : isTailscaleRunning();
  if (running) return;

  // Daemon alive but funnel dropped → recover funnel only; never full-restart (preserves login/daemon).
  if (isDaemonAlive() && svc.activeLocalPort) {
    try {
      await startFunnel(svc.activeLocalPort);
      svc.lastRestartAt = Date.now();
      console.log("[Tailscale] funnel re-established (daemon alive)");
    } catch (err: unknown) {
      console.error("[Tailscale] funnel recovery failed:", (err as Error).message);
    }
    return;
  }

  const force: boolean = FORCE_RESTART_REASONS.test(reason);
  if (!force && Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) {
    console.log(`[Tailscale] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await checkInternet()) return;

  console.log(`[Tailscale] safeRestart (${reason}) — daemon not running${force ? " [force]" : ""}`);
  try {
    await enableTailscale();
    svc.lastRestartAt = Date.now();
    console.log("[Tailscale] restart success");
  } catch (err: unknown) {
    console.error("[Tailscale] restart failed:", (err as Error).message);
  }
}

// ─── Watchdog: 60s tick check both services ──────────────────────────────────

function startWatchdog(): void {
  if (g.watchdogInterval) return;
  g.watchdogInterval = setInterval(() => {
    safeRestartTunnel("watchdog").catch(() => {});
    safeRestartTailscale("watchdog").catch(() => {});
  }, WATCHDOG_INTERVAL_MS);
  if (g.watchdogInterval.unref) g.watchdogInterval.unref();
}

function stopWatchdog(): void {
  if (!g.watchdogInterval) return;
  clearInterval(g.watchdogInterval);
  g.watchdogInterval = null;
}

// ─── Network monitor: detect IPv4 fingerprint change + sleep/wake ────────────

function getNetworkFingerprint(): string {
  const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces();
  const active: string[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    if (VIRTUAL_IFACE_REGEX.test(name)) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push(`${name}:${addr.address}`);
      }
    }
  }
  return active.sort().join("|");
}

function startNetworkMonitor(): void {
  if (g.networkMonitorInterval) return;

  g.lastNetworkFingerprint = getNetworkFingerprint();
  g.lastWatchdogTick = Date.now();
  g.lastOnline = null;

  g.networkMonitorInterval = setInterval(async () => {
    try {
      const now: number = Date.now();
      const elapsed: number = now - g.lastWatchdogTick;
      g.lastWatchdogTick = now;

      const currentFingerprint: string = getNetworkFingerprint();
      const networkChanged: boolean = currentFingerprint !== g.lastNetworkFingerprint;
      const wasSleep: boolean = elapsed > NETWORK_CHECK_INTERVAL_MS * 6;
      if (networkChanged) g.lastNetworkFingerprint = currentFingerprint;

      // Real reachability check (TCP 1.1.1.1:443) — not just interface presence
      const online: boolean = await checkInternet();
      const wasOffline: boolean = g.lastOnline === false;
      g.lastOnline = online;

      if (!online) return; // no internet → idle, don't restart

      const onlineEdge: boolean = wasOffline; // offline → online transition
      if (!networkChanged && !wasSleep && !onlineEdge) return;

      // Wait for DHCP/DNS to settle before probing
      await new Promise<void>((r) => setTimeout(r, NETWORK_SETTLE_MS));

      const reason: string = onlineEdge ? "online"
        : wasSleep && networkChanged ? "sleep+netchange"
        : wasSleep ? "sleep" : "netchange";
      safeRestartTunnel(reason).catch(() => {});
      safeRestartTailscale(reason).catch(() => {});
    } catch (err: unknown) {
      console.error("[NetworkMonitor] error:", (err as Error).message);
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  if (g.networkMonitorInterval.unref) g.networkMonitorInterval.unref();
}


function stopNetworkMonitor(): void {
  if (!g.networkMonitorInterval) return;
  clearInterval(g.networkMonitorInterval);
  g.networkMonitorInterval = null;
  g.lastNetworkFingerprint = null;
  g.lastOnline = null;
}

/** Records which account started the machine-level tunnel/Tailscale process. */
export function setTunnelOwner(userId: string): void {
  g.tunnelOwner = userId;
}

export function setTailscaleOwner(userId: string): void {
  g.tailscaleOwner = userId;
}

export function configureTunnelMonitoring(settings: Settings): void {
  if (settings?.tunnelEnabled || settings?.tailscaleEnabled) {
    startWatchdog();
    startNetworkMonitor();
    return;
  }
  stopWatchdog();
  stopNetworkMonitor();
}
