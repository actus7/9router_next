import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateApiKey } from "@/lib/db/repos/apiKeysRepo";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";
import { NEON_AUTH_COOKIE_PREFIX } from "@neondatabase/auth/server";

const CLI_TOKEN_HEADER: string = "x-9r-cli-token";
const CLI_TOKEN_SALT: string = "9r-cli-auth";

let cachedCliToken: string | null = null;
async function getCliToken(): Promise<string> {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request: Request): Promise<boolean> {
  const token: string | null = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Reachable without a session. `/api/auth` is Neon Auth's own surface — the
// sign-in request itself cannot require being signed in.
const PUBLIC_API_PATHS: string[] = [
  "/api/health",
  "/api/locale",
  "/api/auth",
  "/api/version",
];

// Every rewrite in next.config.ts that targets /api/v1* must appear here: the
// proxy matches the pre-rewrite path, so a missing prefix skips the API-key
// check entirely. tests/unit/dashboardGuard.test.ts enforces the pairing.
const PUBLIC_PREFIXES: string[] = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"];

const ALWAYS_PROTECTED: string[] = [
  "/api/settings/database",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

const LOCAL_ONLY_PATHS: string[] = [
  // Stops the process. Nobody reaching the deployment over the network has any
  // business doing that, signed in or not — it is the CLI updating itself.
  "/api/version/update",
  "/api/cli-tools/cowork-settings",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
];

/**
 * Anything with a file extension, which under this matcher means a file served
 * from `public/`: translation literals, provider logos, icons.
 *
 * The proxy matcher only excludes `_next/*` and the favicon, so everything else
 * in `public/` reaches here. Before accounts that was harmless — this guard
 * ended in `NextResponse.next()`. Now anything it does not claim falls through
 * to the Neon Auth middleware, which answers an unauthenticated request with a
 * redirect to the sign-in page. The symptom was a `<script>` fetching
 * `/i18n/literals/pt-BR.json`, getting HTML, and every label on the sign-in
 * page silently staying English.
 */
const PUBLIC_FILE: RegExp = /\.[^/]+$/;

export function isPublicAsset(pathname: string): boolean {
  return PUBLIC_FILE.test(pathname);
}

const LOOPBACK_HOSTS: Set<string> = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(h: string | null | undefined): boolean {
  if (!h) return false;
  let name: string = String(h).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end: number = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.indexOf(":") !== -1 && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

function isLoopbackPeer(request: Request): boolean {
  if (hasTrustedPeerHeaders(request)) {
    return isLoopbackHostname(request.headers.get("x-9r-real-ip"));
  }
  if (process.env.NODE_ENV === "development") {
    return isLoopbackHostname(request.headers.get("host"));
  }
  return false;
}

export function isLocalRequest(request: Request): boolean {
  if (request.headers.get("x-9r-via-proxy")) return false;
  if (!isLoopbackPeer(request)) return false;
  const origin: string | null = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p: string) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request: NextRequest): string | null {
  const authHeader: string | null = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader: string | null = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader: string | null = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return request.nextUrl?.searchParams?.get("key") || null;
}

async function hasValidApiKey(request: NextRequest): Promise<boolean> {
  const apiKey: string | null = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

/**
 * A gateway call is authorised by its API key, and by nothing else.
 *
 * Local callers used to be waved through unconditionally. That was safe when
 * the instance had one operator and one set of provider accounts; now the key
 * is what says *whose* accounts and quota the request spends, so a request
 * without one has no owner to bill and no rows it is allowed to read.
 */
async function canAccessPublicLlmApi(request: NextRequest): Promise<boolean> {
  return await hasValidApiKey(request);
}

async function canAccessLocalOnlyRoute(request: NextRequest): Promise<boolean> {
  if (await hasValidCliToken(request)) return true;
  return isLocalRequest(request) && hasSessionCookie(request);
}

/**
 * Whether a session cookie is present at all.
 *
 * The prefix comes from the SDK rather than being written out here. It was
 * spelled by hand once — `neon-auth.` — and the real name is
 * `__Secure-neon-auth.*`, so this returned false for every request and the
 * dashboard answered 401 to its own fetches while the pages themselves loaded
 * fine, because those go through Neon's middleware instead of this check.
 *
 * Deliberately does not verify the cookie: `auth.middleware()` validates and
 * refreshes the session for page routes, and every dashboard API handler
 * re-checks it through `tenantRoute`, which is what actually decides whose
 * data is returned. A third implementation of the same check would be a third
 * thing to get wrong.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith(NEON_AUTH_COOKIE_PREFIX));
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  isPublicAsset,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
  hasSessionCookie,
};

export async function proxy(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;

  if (LOCAL_ONLY_PATHS.some((p: string) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  if (ALWAYS_PROTECTED.some((p: string) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || hasSessionCookie(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.some((p: string) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }
    if (await hasValidCliToken(request)) return NextResponse.next();
    if (hasSessionCookie(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // A file in `public/` is not a page and has no session to check.
  if (isPublicAsset(pathname)) return NextResponse.next();

  // Page routes: null hands the request to the Neon Auth middleware, which
  // validates the session, refreshes it when it is close to expiring, and
  // redirects to the sign-in page when there is none.
  return null;
}
