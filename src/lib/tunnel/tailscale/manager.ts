import { loadState, generateShortId } from "../shared/state";
import { throwIfCancelled } from "../shared/cancel";
import {
  cancelService,
  createTunnelServiceState,
  finishEnable,
  prepareEnable,
} from "../shared/serviceState";
import type { DisableResult, TunnelServiceState } from "../shared/types";
import { startFunnel, stopFunnel, isTailscaleRunning, isTailscaleRunningStrict, isTailscaleLoggedIn, isTailscaleLoggedInStrict, startLogin, startDaemonWithPassword, provisionCert } from "./tailscale";
import { waitForHealth } from "./healthCheck";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/lib/elevatedExec";

initDbHooks(getSettings, updateSettings);

const svc: TunnelServiceState = createTunnelServiceState();

export function getTailscaleService(): TunnelServiceState { return svc; }
export function isTailscaleReconnecting(): boolean { return svc.spawnInProgress; }

interface EnableResult {
  success: boolean;
  tunnelUrl?: string;
  needsLogin?: boolean;
  authUrl?: string;
  funnelNotEnabled?: boolean;
  enableUrl?: string;
  error?: string;
}

export async function enableTailscale(localPort: number = 20128): Promise<EnableResult> {
  console.log(`[Tailscale] enable start (port=${localPort})`);
  const token = prepareEnable(svc, localPort);

  try {
    const sudoPass: string = getCachedPassword() || await loadEncryptedPassword() || "";
    await startDaemonWithPassword(sudoPass);
    console.log("[Tailscale] daemon ready");
    throwIfCancelled(token, "tailscale cancelled");

    const existing = loadState();
    const shortId: string = existing?.shortId || generateShortId();
    const tsHostname: string = shortId;

    const loggedIn: boolean = await isTailscaleLoggedInStrict();
    console.log(`[Tailscale] loggedIn=${loggedIn}`);
    if (!loggedIn) {
      const loginResult = await startLogin(tsHostname);
      if (loginResult.authUrl) {
        console.log(`[Tailscale] needs login, authUrl=${loginResult.authUrl}`);
        return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
      }
      console.log("[Tailscale] login resolved alreadyLoggedIn");
    }
    throwIfCancelled(token, "tailscale cancelled");

    stopFunnel();
    let result: { tunnelUrl: string; funnelNotEnabled?: boolean; enableUrl?: string };
    try {
      console.log("[Tailscale] starting funnel");
      result = await startFunnel(localPort);
    } catch (e: unknown) {
      console.error(`[Tailscale] funnel error: ${(e as Error).message}`);
      if (/NoState|unexpected state|not logged in|Logged ?out|NeedsLogin/i.test((e as Error).message || "")) {
        console.error("[Tailscale] retry via startLogin");
        const loginResult = await startLogin(tsHostname);
        if (loginResult.authUrl) return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
      }
      throw e;
    }
    throwIfCancelled(token, "tailscale cancelled");

    if (result.funnelNotEnabled) {
      console.log(`[Tailscale] funnel not enabled, enableUrl=${result.enableUrl}`);
      return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };
    }

    if (!(await isTailscaleLoggedInStrict()) || !(await isTailscaleRunningStrict())) {
      console.log("[Tailscale] strict probe failed (device removed?)");
      stopFunnel();
      return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
    }

    await updateSettings({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });
    console.log(`[Tailscale] funnel up: ${result.tunnelUrl}`);

    const hostname: string = new URL(result.tunnelUrl).hostname;
    await provisionCert(hostname);

    let reachableNow: boolean = false;
    try {
      await waitForHealth(result.tunnelUrl, token);
      reachableNow = true;
    } catch (he: unknown) {
      if (!(he as Error).message.startsWith("Health check timeout")) throw he;
      console.warn(`[Tailscale] health check timed out, will retry via watchdog`);
    }
    console.log(`[Tailscale] enable success (reachable=${reachableNow})`);
    return { success: true, tunnelUrl: result.tunnelUrl };
  } catch (e: unknown) {
    console.error(`[Tailscale] enable error: ${(e as Error).message}`);
    throw e;
  } finally {
    finishEnable(svc);
  }
}

export async function disableTailscale(): Promise<DisableResult> {
  console.log("[Tailscale] disable");
  cancelService(svc);
  stopFunnel();
  await updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
  return { success: true };
}

interface TailscaleStatus {
  enabled: boolean;
  settingsEnabled: boolean;
  tunnelUrl: string;
  running: boolean;
  loggedIn: boolean;
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const settings: Record<string, unknown> = await getSettings() as Record<string, unknown>;
  const settingsEnabled: boolean = settings.tailscaleEnabled === true;
  const tunnelUrl: string = (settings.tailscaleUrl as string) || "";
  const loggedIn: boolean = settingsEnabled ? isTailscaleLoggedIn() : false;
  const running: boolean = loggedIn ? isTailscaleRunning() : false;
  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    running,
    loggedIn
  };
}
