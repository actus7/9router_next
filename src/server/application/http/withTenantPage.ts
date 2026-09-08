import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { withTenant } from "@/lib/db/tenant";
import { currentUserId } from "@/server/application/http/tenantRoute";

/**
 * The Server Component counterpart of `tenantRoute`: runs `render` as the
 * signed-in account, or redirects to sign-in.
 *
 * It takes a callback rather than being a bare `await` at the top of the
 * component, and that shape is load-bearing. The first version established the
 * tenant with `AsyncLocalStorage.enterWith()` and returned — which works in
 * plain Node, and does not work here: React resumes a Server Component's
 * continuations under a context snapshot it captured earlier, so the mutation
 * was discarded at the first `await` and every repo call after it threw
 * `TenantContextError`. `run()` with a callback is scoped by construction and
 * survives that.
 */
export async function withTenantPage<T>(render: () => Promise<T>): Promise<T> {
  // Request data, so the route cannot be prerendered — see tenantRoute.
  await connection();
  const userId: string | null = await currentUserId();
  if (!userId) redirect(SIGN_IN_PATH);
  return withTenant(userId, render);
}
