import { loadState, saveState, generateShortId } from "../shared/state";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared";
import { clearPid } from "./pid";
import { waitForHealth, probeUrlAlive } from "./healthCheck";
import { WORKER_URL } from "./config";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo";
interface CancelToken {
  cancelled: boolean;
}

interface TunnelService {
  cancelToken: CancelToken;
  spawnInProgress: boolean;
  lastRestartAt: number;
  activeLocalPort: number | null;
}

const svc: TunnelService = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

export function getTunnelService(): TunnelService { return svc; }
export function isTunnelManuallyDisabled(): boolean { return svc.cancelToken.cancelled; }
export function isTunnelReconnecting(): boolean { return svc.spawnInProgress; }

let onUnexpectedExit: (() => void) | null = null;
export function setTunnelUnexpectedExitCallback(cb: (() => void) | null): void { onUnexpectedExit = cb; }

async function registerTunnelUrl(shortId: string, tunnelUrl: string): Promise<void> {
  await fetch(`${WORKER_URL}/api/tunnel/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId, tunnelUrl })
  });
}

function throwIfCancelled(token: CancelToken): void {
  if (token.cancelled) throw new Error("tunnel cancelled");
}

interface EnableResult {
  success: boolean;
  tunnelUrl: string;
  shortId: string;
  publicUrl: string;
  alreadyRunning?: boolean;
}

export async function enableTunnel(localPort: number = 20128): Promise<EnableResult> {
  console.log(`[Tunnel] enable start (port=${localPort})`);
  svc.cancelToken = { cancelled: false };
  svc.activeLocalPort = localPort;
  svc.spawnInProgress = true;
  const token: CancelToken = svc.cancelToken;

  try {
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && existing?.shortId) {
        const publicUrl: string = `https://r${existing.shortId}.abc-tunnel.us`;
        const [directOk, publicOk] = await Promise.all([
          probeUrlAlive(existing.tunnelUrl),
          probeUrlAlive(publicUrl),
        ]);
        if (directOk && publicOk) {
          console.log(`[Tunnel] already running, reuse: ${existing.tunnelUrl}`);
          return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
        }
        console.log(`[Tunnel] stale (direct=${directOk} public=${publicOk}), respawn`);
      }
    }

    killCloudflared(localPort);
    console.log("[Tunnel] killed existing cloudflared");
    throwIfCancelled(token);

    const existing = loadState();
    const shortId: string = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url: string): Promise<void> => {
      if (token.cancelled) return;
      console.log(`[Tunnel] url updated: ${url}`);
      await registerTunnelUrl(shortId, url);
      saveState({ shortId, tunnelUrl: url });
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    setUnexpectedExitHandler(() => {
      console.warn("[Tunnel] cloudflared exited unexpectedly, scheduling respawn");
      if (onUnexpectedExit) onUnexpectedExit();
    });

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    console.log(`[Tunnel] spawned: ${tunnelUrl}`);
    throwIfCancelled(token);

    const publicUrl: string = `https://r${shortId}.abc-tunnel.us`;
    await registerTunnelUrl(shortId, tunnelUrl);
    saveState({ shortId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });
    console.log(`[Tunnel] registered shortId=${shortId} publicUrl=${publicUrl}`);

    await waitForHealth(publicUrl, token);
    console.log("[Tunnel] public URL healthy");
    if (!(await probeUrlAlive(tunnelUrl))) {
      console.warn("[Tunnel] direct URL not reachable yet, continuing via publicUrl");
    } else {
      console.log("[Tunnel] direct URL healthy");
    }

    console.log("[Tunnel] enable success");
    return { success: true, tunnelUrl, shortId, publicUrl };
  } catch (e: unknown) {
    if (!/cloudflared killed|tunnel cancelled/.test((e as Error).message)) {
      console.error(`[Tunnel] enable error: ${(e as Error).message}`);
    }
    throw e;
  } finally {
    svc.spawnInProgress = false;
  }
}

interface DisableResult {
  success: boolean;
}

export async function disableTunnel(): Promise<DisableResult> {
  console.log("[Tunnel] disable");
  svc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);

  try { killCloudflared(svc.activeLocalPort!); } catch (e: unknown) { console.warn(`[Tunnel] kill warn: ${(e as Error).message}`); }
  clearPid();

  const state = loadState();
  if (state) saveState({ shortId: state.shortId, tunnelUrl: null });

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  svc.spawnInProgress = false;
  svc.activeLocalPort = null;
  return { success: true };
}

interface TunnelStatus {
  enabled: boolean;
  settingsEnabled: boolean;
  tunnelUrl: string;
  shortId: string;
  publicUrl: string;
  running: boolean;
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const settings: Record<string, unknown> = await getSettings() as Record<string, unknown>;
  const settingsEnabled: boolean = settings.tunnelEnabled === true;
  const state = loadState();
  const shortId: string = state?.shortId || "";
  const publicUrl: string = shortId ? `https://r${shortId}.abc-tunnel.us` : "";
  const tunnelUrl: string = state?.tunnelUrl || "";

  const running: boolean = settingsEnabled ? isCloudflaredRunning() : false;

  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    shortId,
    publicUrl,
    running
  };
}
