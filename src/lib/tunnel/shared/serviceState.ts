import type { CancelToken, TunnelServiceState } from "./types";

export function createTunnelServiceState(): TunnelServiceState {
  return {
    cancelToken: { cancelled: false },
    spawnInProgress: false,
    lastRestartAt: 0,
    activeLocalPort: null,
  };
}

export function prepareEnable(svc: TunnelServiceState, localPort: number): CancelToken {
  svc.cancelToken = { cancelled: false };
  svc.activeLocalPort = localPort;
  svc.spawnInProgress = true;
  return svc.cancelToken;
}

export function finishEnable(svc: TunnelServiceState): void {
  svc.spawnInProgress = false;
}

export function cancelService(svc: TunnelServiceState): void {
  svc.cancelToken.cancelled = true;
}
