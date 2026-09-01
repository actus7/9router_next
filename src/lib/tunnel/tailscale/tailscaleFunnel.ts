import { execSync, spawn, type ChildProcess } from "child_process";

interface FunnelRuntime {
  bin: string | null;
  socketFlags: string[];
  args: string[];
  getActualUrl: () => string | null;
  getFallbackUrl: () => string | null;
}

export interface FunnelResult {
  tunnelUrl: string;
  funnelNotEnabled?: boolean;
  enableUrl?: string;
}

/** Start tailscale funnel for the given port */
export async function startFunnelForRuntime(port: number, runtime: FunnelRuntime): Promise<FunnelResult> {
  const { bin, socketFlags, args, getActualUrl, getFallbackUrl } = runtime;
  if (!bin) throw new Error("Tailscale not installed");

  try { execSync(`"${bin}" ${socketFlags.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch  { /* ignore */ }

  return new Promise<FunnelResult>((resolve: (value: FunnelResult) => void, reject: (reason: Error) => void) => {
    const child: ChildProcess = spawn(/*turbopackIgnore: true*/ bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let resolved: boolean = false;
    let output: string = "";

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const url: string | null = getActualUrl() || getFallbackUrl();
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    const parseFunnelUrl = (): string | null => getActualUrl();

    let funnelNotEnabled: boolean = false;

    const handleData = (data: Buffer): void => {
      output += data.toString();

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      if (funnelNotEnabled && !resolved) {
        const enableMatch: RegExpMatchArray | null = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ tunnelUrl: "", funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url: string | null = parseFunnelUrl();
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout!.on("data", handleData);
    child.stderr!.on("data", handleData);

    child.on("exit", (code: number | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.log(`[Tailscale] funnel exit code=${code} output="${output.trim().slice(0, 200)}"`);
      const url: string | null = parseFunnelUrl() || getFallbackUrl();
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}


