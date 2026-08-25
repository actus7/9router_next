import { pathToFileURL } from "url";
import { getInstallInfo, libraryEntry } from "./install";

interface CachedModule {
  module: Record<string, unknown>;
  version: string | null;
  loadedAt: number;
}

// Module cache: pxpipe is loaded once per process ("started") and dropped on
// "stop". In library mode start/stop govern the in-process module, not a daemon.
let cached: CachedModule | null = null;
let loadPromise: Promise<CachedModule> | null = null;

interface LoadedInfo {
  loaded: boolean;
  version?: string | null;
  loadedAt?: number;
}

export function getLoadedInfo(): LoadedInfo {
  return cached ? { loaded: true, version: cached.version, loadedAt: cached.loadedAt } : { loaded: false };
}

export async function loadPxpipe(): Promise<CachedModule> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = doLoad().finally(() => { loadPromise = null; });
  return loadPromise;
}

async function doLoad(): Promise<CachedModule> {
  const info = getInstallInfo();
  if (!info.installed) {
    const err: Error & { code?: string } = new Error("PXPIPE is not installed") as Error & { code?: string };
    err.code = "NOT_INSTALLED";
    throw err;
  }
  // Cache-bust per version so Repair/upgrade takes effect without a server restart.
  const url: string = `${pathToFileURL(libraryEntry()).href}?v=${encodeURIComponent(info.version || "0")}`;
  const mod: Record<string, unknown> = await import(/* webpackIgnore: true */ url) as Record<string, unknown>;
  if (typeof mod.transformAnthropicMessages !== "function") {
    throw new Error("installed pxpipe package does not export transformAnthropicMessages");
  }
  cached = { module: mod, version: info.version, loadedAt: Date.now() };
  return cached;
}

export function unloadPxpipe(): boolean {
  const wasLoaded: boolean = !!cached;
  cached = null;
  return wasLoaded;
}

interface TransformResult {
  applied: boolean;
  reason?: string;
  body: Uint8Array;
}

type TransformFn = (params: { body: Uint8Array; model: string }) => Promise<TransformResult>;

// Transform function for the request pipeline; null when unavailable (fail-open).
// autoLoad controls whether a cold cache triggers a load (first request warms it).
export async function getTransform({ autoLoad = true }: { autoLoad?: boolean } = {}): Promise<TransformFn | null> {
  try {
    if (!cached && !autoLoad) return null;
    const { module: mod } = await loadPxpipe();
    return mod.transformAnthropicMessages as TransformFn;
  } catch {
    return null;
  }
}

interface SelfTestResult {
  ok: true;
  reason: string | undefined;
  durationMs: number;
}

// Health self-test: run a tiny synthetic Claude request through the transformer.
export async function selfTest(): Promise<SelfTestResult> {
  const startedAt: number = Date.now();
  const { module: mod } = await loadPxpipe();
  const body: Uint8Array = new TextEncoder().encode(JSON.stringify({
    model: "claude-fable-5",
    max_tokens: 16,
    messages: [{ role: "user", content: "ping" }],
  }));
  const transformFn = mod.transformAnthropicMessages as TransformFn;
  const result: TransformResult = await transformFn({ body, model: "claude-fable-5" });
  if (!result || typeof result.applied !== "boolean" || !(result.body instanceof Uint8Array)) {
    throw new Error("transform returned an unexpected shape");
  }
  return { ok: true, reason: result.reason, durationMs: Date.now() - startedAt };
}
