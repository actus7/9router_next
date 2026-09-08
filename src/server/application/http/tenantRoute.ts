import "server-only";

import { NextResponse, connection } from "next/server";

import { auth } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/tenant";

/**
 * The account behind the current request, or null when nobody is signed in.
 *
 * Answered from the signed session-data cookie the Neon Auth middleware keeps
 * fresh, so the common case is memory, not a round trip.
 */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await auth.getSession();
    return data?.user?.id ?? null;
  } catch {
    // A failure to reach the auth service must read as "not signed in", never
    // as "signed in as nobody" — the caller turns null into a 401.
    return null;
  }
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
    const userId: string | null = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return withTenant(userId, async () => handler(...args));
  };
}
