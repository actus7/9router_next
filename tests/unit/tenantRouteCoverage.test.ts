import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every HTTP entry point establishes a tenant, or is on this list saying why not.
 *
 * The tenant lives in an AsyncLocalStorage that a route handler has to enter;
 * Next runs middleware in a different execution context, so `proxy.ts` cannot
 * do it on anyone's behalf. That leaves ~180 handlers each of which must be
 * wrapped, and a wrapper is exactly the kind of thing a new route forgets.
 *
 * Forgetting fails closed — `currentTenantId()` throws rather than returning
 * everyone's rows — so the consequence is a 500, not a leak. This test turns
 * that 500 into a failing build instead of a bug report.
 */
const apiRoot = resolve(__dirname, "../../src/app/api");
const dashboardRoot = resolve(__dirname, "../../src/app/(dashboard)");
const srcRoot = resolve(__dirname, "../../src");

/**
 * Routes that answer before anyone is signed in, each with the reason.
 *
 * Exact route paths, not prefixes. It used to be the first path segment, and
 * `version` — exempt because it reports a build number — silently covered
 * `version/update`, which kills the server process. One unauthenticated POST
 * was a remote shutdown. An exemption now names the one route it excuses.
 */
const UNSCOPED: ReadonlyArray<{ route: string; why: string }> = [
  { route: "auth/[...path]", why: "Neon Auth's own surface. The sign-in request cannot require being signed in." },
  { route: "health", why: "Liveness probe. Reads nothing." },
  { route: "locale", why: "Returns the UI language list, identical for everyone." },
  { route: "version", why: "Reports the build version, identical for everyone." },
  { route: "csp-report", why: "Violation reports arrive from a page that may have just been blocked; a session gate would drop the ones worth reading. Writes no rows." },
];

const TENANT_WRAPPERS: readonly string[] = ["tenantRoute(", "gatewayRoute("];

/** What a Server Action may use to establish the owner, since no route wraps it. */
const ACTION_TENANT_WRAPPERS: readonly string[] = ["withDashboardSession(", "withTenant("];

function listRouteFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listRouteFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

function routeName(path: string): string {
  return relative(apiRoot, path).replaceAll("\\", "/").replace(/\/route\.ts$/, "");
}

function isUnscoped(path: string): boolean {
  return UNSCOPED.some((entry) => routeName(path) === entry.route);
}

const HANDLER = /^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD)\b/m;

describe("tenant route coverage", () => {
  it("finds the routes it is meant to be checking", () => {
    const files = listRouteFiles(apiRoot);
    expect(files.length).toBeGreaterThan(150);
  });

  it("wraps every route that exports a handler", () => {
    const offenders = listRouteFiles(apiRoot)
      .filter((path) => !isUnscoped(path))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        if (!HANDLER.test(source)) return false;
        return !TENANT_WRAPPERS.some((wrapper) => source.includes(wrapper));
      })
      .map((path) => relative(apiRoot, path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });

  it("keeps every exemption pointing at a route that exists", () => {
    const routes = new Set(listRouteFiles(apiRoot).map(routeName));
    for (const entry of UNSCOPED) {
      expect(routes.has(entry.route), `${entry.route} is exempted but is not a route`).toBe(true);
    }
  });

  it("authenticates the gateway with an API key, not a session", () => {
    // The gateway's callers are programs holding a key, not browsers holding a
    // cookie; wrapping it in tenantRoute would 401 every one of them.
    for (const dir of ["v1", "v1beta"]) {
      for (const path of listRouteFiles(join(apiRoot, dir))) {
        const source = readFileSync(path, "utf8");
        if (!HANDLER.test(source)) continue;
        expect(source, relative(apiRoot, path)).toContain("gatewayRoute(");
      }
    }
  });
});

/**
 * Server Components and Server Actions are the other two entry points, and
 * they were the ones that got it wrong: they first established the tenant with
 * `enterWith` and returned, which React discards when it resumes their
 * continuations under an earlier context snapshot. Both take a callback now,
 * and this checks that every one of them actually does.
 */
function listFiles(directory: string, match: (entry: string) => boolean): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listFiles(path, match);
    return match(entry) ? [path] : [];
  });
}

const READS_TENANT_DATA = /@\/lib\/db|@\/lib\/data-access/;

describe("tenant coverage outside route handlers", () => {
  it("wraps every dashboard page that reads tenant data", () => {
    const offenders = listFiles(dashboardRoot, (e) => e === "page.tsx")
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return READS_TENANT_DATA.test(source) && !source.includes("withTenantPage(");
      })
      .map((path) => relative(dashboardRoot, path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });

  it("wraps every server action", () => {
    // Scans for the directive rather than one directory. There are no Server
    // Actions left — the dashboard reaches the domain through `tenantRoute`
    // handlers — and the directory that used to hold them is gone, so a check
    // rooted at that path would throw instead of guarding anything. A file
    // carrying "use server" exports functions the browser calls directly, with
    // no route wrapper above them, so each has to establish the owner itself.
    const offenders = listFiles(srcRoot, (e) => e.endsWith(".ts") || e.endsWith(".tsx"))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        if (!/^\s*["']use server["'];/m.test(source)) return false;
        return (
          /^export async function /m.test(source) &&
          !ACTION_TENANT_WRAPPERS.some((wrapper) => source.includes(wrapper))
        );
      })
      .map((path) => relative(srcRoot, path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });

  it("leaves no caller of the context-mutating helper that React discards", () => {
    // `enterTenant` was removed for exactly this reason; a reintroduced one
    // would work in a script and fail in a Server Component.
    const all = [
      ...listFiles(srcRoot, (e) => e.endsWith(".ts") || e.endsWith(".tsx")),
    ];
    const offenders = all
      .filter((path) => /enterTenant/.test(readFileSync(path, "utf8")))
      .map((path) => relative(srcRoot, path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });
});

