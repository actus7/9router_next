export interface CancelToken {
  cancelled: boolean;
}

export interface TunnelServiceState {
  cancelToken: CancelToken;
  spawnInProgress: boolean;
  lastRestartAt: number;
  activeLocalPort: number | null;
}

export interface DisableResult {
  success: boolean;
}

export interface HealthCheckConfig {
  intervalMs: number;
  timeoutMs: number;
  fetchTimeoutMs: number;
  dnsTimeoutMs: number;
}
