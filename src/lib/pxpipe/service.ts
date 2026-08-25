import { getInstallInfo, isInstalling, findNpm } from "./install";
import { getLoadedInfo, loadPxpipe, selfTest } from "./loader";

interface PxpipeStatus {
  installed: boolean;
  installing: boolean;
  version: string | null;
  path: string | null;
  running: boolean;
  loadedAt: number | null;
  uptimeMs: number;
  npmAvailable: boolean;
  mode: string;
}

// Aggregate status for the Token Saver card and /api/pxpipe/status.
// "running" in library mode = module loaded into this process.
export function getPxpipeStatus(): PxpipeStatus {
  const install = getInstallInfo();
  const loaded = getLoadedInfo();
  return {
    installed: install.installed,
    installing: isInstalling(),
    version: install.version,
    path: install.path,
    running: loaded.loaded,
    loadedAt: loaded.loadedAt || null,
    uptimeMs: loaded.loaded ? Date.now() - loaded.loadedAt! : 0,
    npmAvailable: !!findNpm(),
    mode: "library", // in-process transform, not an external proxy
  };
}

interface HealthCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string | null;
}

interface HealthCheckResult {
  healthy: boolean;
  checks: HealthCheck[];
  error: string | null;
}

// PRD health checklist, adapted to library mode: installed? → module loads
// (the "executable found / port listening" equivalent) → test request transforms.
export async function runHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheck[] = [];
  const fail = (error: string): HealthCheckResult => ({ healthy: false, checks, error });

  const install = getInstallInfo();
  checks.push({ id: "installed", label: "PXPIPE installed", ok: install.installed, detail: install.version ? `v${install.version}` : null });
  if (!install.installed) return fail("pxpipe not installed");

  try {
    await loadPxpipe();
    checks.push({ id: "module", label: "Transform module loads", ok: true, detail: `v${install.version}` });
  } catch (e: unknown) {
    checks.push({ id: "module", label: "Transform module loads", ok: false, detail: (e as Error).message });
    return fail(`Cannot load module: ${(e as Error).message}`);
  }

  try {
    const test = await selfTest();
    checks.push({ id: "transform", label: "Test request transforms", ok: true, detail: `${test.durationMs}ms (${test.reason})` });
  } catch (e: unknown) {
    checks.push({ id: "transform", label: "Test request transforms", ok: false, detail: (e as Error).message });
    return fail(`Self-test failed: ${(e as Error).message}`);
  }

  return { healthy: true, checks, error: null };
}
