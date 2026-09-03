// Cloudflare service
export {
  enableTunnel,
  disableTunnel,
  getTunnelStatus,
  isTunnelManuallyDisabled,
  isTunnelReconnecting,
  getTunnelService,
  setTunnelUnexpectedExitCallback,
} from "./cloudflare/manager";
export {
  killCloudflared,
  isCloudflaredRunning,
  ensureCloudflared,
  getDownloadStatus,
} from "./cloudflare/cloudflared";

// Tailscale service
export {
  enableTailscale,
  disableTailscale,
  getTailscaleStatus,
  isTailscaleReconnecting,
  getTailscaleService,
} from "./tailscale/manager";
export {
  isTailscaleInstalled,
  isTailscaleRunning,
  isTailscaleRunningStrict,
  isTailscaleLoggedIn,
  isSystemDaemonRunning,
  isDaemonAlive,
  startFunnel,
  getTailscaleBin,
  installTailscale,
  TAILSCALE_SOCKET,
} from "./tailscale/tailscale";
// probeUrlAlive re-exported from cloudflare/healthCheck above (line 17); tailscale variant removed to avoid duplicate

// Shared
export { loadState, generateShortId } from "./shared/state";
export { checkInternet } from "./shared/internetCheck";
export type { CancelToken, TunnelServiceState, DisableResult, HealthCheckConfig } from "./shared/types";
export {
  RESTART_COOLDOWN_MS,
  NETWORK_SETTLE_MS,
  WATCHDOG_INTERVAL_MS,
  NETWORK_CHECK_INTERVAL_MS,
  VIRTUAL_IFACE_REGEX,
} from "./shared/watchdogConfig";
