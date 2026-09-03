import { resolveDns } from "./dnsResolver";
import type { CancelToken, HealthCheckConfig } from "./types";

export async function probeUrlAlive(url: string, config: HealthCheckConfig): Promise<boolean> {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  if (!(await resolveDns(hostname, config.dnsTimeoutMs))) return false;

  try {
    const res: Response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(
  url: string,
  config: HealthCheckConfig,
  cancelToken: CancelToken = { cancelled: false },
): Promise<boolean> {
  const start: number = Date.now();
  while (Date.now() - start < config.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url, config)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, config.intervalMs));
  }
  throw new Error(`Health check timeout after ${config.timeoutMs}ms`);
}
