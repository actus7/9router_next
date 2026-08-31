// Next.js instrumentation hook. See docs/ARCHITECTURE.md for host boundaries.
//
// Scope decision (documented in src/server/llm-gateway/NEXTJS_ADOPTION.md):
// this file stays observability-focused. The token-refresh scheduler is NOT
// started here — it keeps running through shared/services/bootstrap with its
// idempotency guards (global.__appBootstrapped, `started` flag, env kill
// switch), which is compatible with both long-running and replicated deploys.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();
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
