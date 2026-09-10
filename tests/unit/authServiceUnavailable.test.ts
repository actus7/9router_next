import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { NEON_AUTH_COOKIE_PREFIX } from "@neondatabase/auth/server";

const getSession = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession: (...args: unknown[]) => getSession(...args),
    // `src/proxy.ts` builds the middleware at module scope; these tests never
    // invoke it, they only exercise how its answer is translated.
    middleware: () => async () => NextResponse.next(),
  },
}));

import { resolveCurrentUser } from "@/server/application/http/tenantRoute";
import { proxy } from "@/dashboardGuard";

beforeEach(() => {
  getSession.mockReset();
});

/**
 * A throttled auth service is not a signed-out user.
 *
 * Neon Auth rate-limits `/get-session`, and the whole session lookup used to
 * collapse to `string | null`: a 429 read as "nobody is signed in", so saving a
 * combo answered 401 and the dashboard reported being logged out while the
 * session was perfectly valid.
 */
describe("resolveCurrentUser", () => {
  it("reports the account when the session resolves", async () => {
    getSession.mockResolvedValue({ data: { user: { id: "user_123" } }, error: null });
    await expect(resolveCurrentUser()).resolves.toEqual({ userId: "user_123", unavailable: false });
  });

  it("reads an empty session as signed out, not as an outage", async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    await expect(resolveCurrentUser()).resolves.toEqual({ userId: null, unavailable: false });
  });

  it("reads a rejected session as signed out", async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 401, message: "Unauthorized" } });
    await expect(resolveCurrentUser()).resolves.toEqual({ userId: null, unavailable: false });
  });

  it("separates a rate-limited auth service from a signed-out user", async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 429, message: "Too Many Requests" } });
    await expect(resolveCurrentUser()).resolves.toEqual({ userId: null, unavailable: true });
  });

  it("separates an unreachable auth service from a signed-out user", async () => {
    getSession.mockRejectedValue(new Error("fetch failed"));
    await expect(resolveCurrentUser()).resolves.toEqual({ userId: null, unavailable: true });
  });
});

/**
 * The `session_data` cookie is what keeps `getSession()` off the network, and
 * only the Neon Auth middleware mints it. The guard used to answer every
 * `/api/*` request itself, so the dashboard — which is almost entirely `/api/*`
 * traffic — never refreshed the cookie: five minutes after the last page
 * navigation the cache lapsed and every single API call went upstream, until
 * Neon started answering 429.
 */
describe("dashboard API requests refresh the session cache", () => {
  function apiRequest(path: string, cookie?: string): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { cookie } : undefined,
    });
  }

  const sessionCookie = `${NEON_AUTH_COOKIE_PREFIX}.session_token=abc`;

  it("hands a signed-in dashboard API request to the auth middleware", async () => {
    await expect(proxy(apiRequest("/api/combos", sessionCookie))).resolves.toBeNull();
  });

  it("still answers 401 itself when there is no session cookie", async () => {
    const response = await proxy(apiRequest("/api/combos"));
    expect(response?.status).toBe(401);
  });

  it("keeps answering public API paths without a session", async () => {
    for (const path of ["/api/health", "/api/locale", "/api/version"]) {
      const response = await proxy(apiRequest(path));
      expect(response, path).not.toBeNull();
      expect(response?.status, path).not.toBe(401);
    }
  });
});

/**
 * The middleware answers an unverifiable session with a redirect to sign-in.
 * `fetch` follows it and hands back HTML with `res.ok === true`, so a save that
 * failed would look like one that worked.
 */
describe("asApiResponse", () => {
  it("turns a sign-in redirect into 401 JSON", async () => {
    process.env.NEON_AUTH_BASE_URL ||= "https://example.neon.tech/db/auth";
    process.env.NEON_AUTH_COOKIE_SECRET ||= "x".repeat(32);
    const { asApiResponse } = await import("@/proxy");

    const redirect = NextResponse.redirect("http://localhost:3000/auth/sign-in");
    redirect.headers.append("Set-Cookie", `${NEON_AUTH_COOKIE_PREFIX}.local.session_data=; Max-Age=0`);
    const converted = asApiResponse(redirect);

    expect(converted.status).toBe(401);
    await expect(converted.json()).resolves.toEqual({ error: "Unauthorized" });
    // The stale-cookie clear the middleware asked for must survive, or the
    // browser keeps replaying a cookie the server already rejected.
    expect(converted.headers.getSetCookie().join()).toContain("Max-Age=0");
  });

  it("leaves a normal response alone", async () => {
    const { asApiResponse } = await import("@/proxy");
    const passthrough = NextResponse.next();
    expect(asApiResponse(passthrough)).toBe(passthrough);
  });
});
