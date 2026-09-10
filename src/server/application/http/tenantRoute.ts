import "server-only";

import { NextResponse, connection } from "next/server";

import { auth } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/tenant";
import { RATE_LIMIT_WINDOW_MS, consumeRateLimit, dashboardRateLimit } from "./rateLimit";

export interface CurrentUser {
  /** The signed-in account, or null when there is none. */
  userId: string | null;
  /** True when the answer is "we could not ask", not "nobody is signed in". */
  unavailable: boolean;
}

/**
 * The account behind the current request.
 *
 * Answered from the signed session-data cookie the Neon Auth middleware keeps
 * fresh, so the common case is memory, not a round trip.
 *
 * The two failure modes are kept apart deliberately. This used to return
 * `string | null`, which folded "nobody is signed in" together with "the auth
 * service did not answer" — so when Neon Auth rate-limited `/get-session` with
 * a 429, every dashboard write came back 401 and the UI reported being logged
 * out while the session was valid. `unavailable` is what lets the caller say
 * "try again" instead of "sign in".
 */
export async function resolveCurrentUser(): Promise<CurrentUser> {
  try {
    const { data, error } = await auth.getSession();
    const userId: string | null = data?.user?.id ?? null;
    if (userId) return { userId, unavailable: false };
    // Only the auth service's own verdict on the session — no session, or one
    // it rejected — means signed out. A 429, a 5xx or anything else is an
    // outage, and answering 401 for an outage signs the user out of a session
    // that is still good.
    const status: number = error?.status ?? 0;
    const rejected: boolean = status === 0 || status === 401 || status === 403;
    return { userId: null, unavailable: !rejected };
  } catch {
    // Could not reach the auth service at all.
    return { userId: null, unavailable: true };
  }
}

/**
 * The account behind the current request, or null when nobody is signed in.
 *
 * Collapses `resolveCurrentUser()` for callers that only decide between "act as
 * this account" and "refuse"; an outage reads as null there. Prefer
 * `resolveCurrentUser` where the caller can report the difference.
 */
export async function currentUserId(): Promise<string | null> {
  return (await resolveCurrentUser()).userId;
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response> | Response;

/**
 * Wraps a dashboard route handler so its database access is scoped to the
 * signed-in account.
 *
 * This is one of the two places a tenant is established — the other is the
 * gateway, from the API key. It has to be here rather than in `proxy.ts`
 * because Next runs middleware in a separate execution context from the route
 * handler, so an AsyncLocalStorage set there does not reach the repos.
 *
 * Applying it is not optional and not a matter of taste: a handler that skips
 * it reaches `currentTenantId()` with nothing in context and throws, which is
 * the fail-closed half of the design. `tests/unit/tenantRouteCoverage.test.ts`
 * is the other half — it fails the build for a dashboard route that forgot.
 */
export function tenantRoute<A extends unknown[]>(handler: Handler<A>): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    // Says out loud that this response depends on the incoming request. The
    // project builds with Cache Components, where a route handler is a
    // prerender candidate until something asks for request data — and a
    // prerendered handler reads no cookie, finds no session and would bake a
    // 401 into the static output for everyone.
    await connection();
    const { userId, unavailable } = await resolveCurrentUser();
    if (!userId) {
      // 503, not 401: the caller may well be signed in, and a 401 here is what
      // made a throttled auth service look like a broken save button.
      if (unavailable) {
        return NextResponse.json(
          { error: "Auth service unavailable, try again" },
          { status: 503, headers: { "Retry-After": "5" } },
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // A ceiling, not a quota. The dashboard polls and streams, so it sits well
    // above normal use; what it stops is a signed-in account looping an
    // endpoint that makes its own outbound request or writes to Neon.
    const limited = consumeRateLimit(`dash:${userId}`, dashboardRateLimit(), RATE_LIMIT_WINDOW_MS);
    if (!limited.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }
    return withTenant(userId, async () => handler(...args));
  };
}
