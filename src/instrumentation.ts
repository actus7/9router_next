// Next.js instrumentation hook. See docs/ARCHITECTURE.md for host boundaries.
//
// Node startup belongs here so layouts remain pure and build/prerender workers
// never start schedulers, tunnel processes or persistent integrations.
const BUILD_PHASES = new Set(["phase-production-build", "phase-export", "phase-static"]);

declare global {
  var __modelHubInstrumentationRegistered: boolean | undefined;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || BUILD_PHASES.has(process.env.NEXT_PHASE ?? "")) return;
  if (globalThis.__modelHubInstrumentationRegistered) return;
  globalThis.__modelHubInstrumentationRegistered = true;

  try {
    const [{ initConsoleLogCapture }, { ensureOutboundProxyInitialized }, { initializeApp }] = await Promise.all([
      import("@/lib/consoleLogBuffer"),
      import("@/lib/network/initOutboundProxy"),
      import("@/shared/services/initializeApp"),
    ]);

    initConsoleLogCapture();
    await ensureOutboundProxyInitialized();
    await initializeApp();
  } catch (error) {
    globalThis.__modelHubInstrumentationRegistered = false;
    throw error;
  }
}

/**
 * Server-side error observability (Next.js 16 instrumentation contract).
 * Failures in Route Handlers, Server Components, Server Actions and proxy
 * land here. Kept best-effort: logging must never mask the original error.
 */
export function onRequestError(
  err: Error,
  request: { path: string; method?: string; headers?: Record<string, string | string[]> },
  context: { routeType: "render" | "route" | "action" | "proxy"; routerKind?: "Pages Router" | "App Router" },
): void {
  const { path, method } = request ?? { path: "<unknown>", method: undefined };
  const routeType = context?.routeType ?? "unknown";
  const routerKind = context?.routerKind ?? "App Router";
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[instrumentation] ${routerKind}/${routeType} ${method ?? "GET"} ${path} — ${message}`);
}
