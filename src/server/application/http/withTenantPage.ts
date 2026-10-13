import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { roleAtLeast, withTenant, type TenantRole } from "@/lib/db/tenant";
import { resolveCurrentTenant } from "@/server/application/http/tenantRoute";

/** Where a member lands when a page is for owners and admins. */
const MEMBER_HOME = "/dashboard/basic-chat";

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
export async function withTenantPage<T>(
  render: () => Promise<T>,
  options: { minRole?: TenantRole } = {},
): Promise<T> {
  // Request data, so the route cannot be prerendered — see tenantRoute.
  await connection();
  const { context, unavailable } = await resolveCurrentTenant();
  // A throttled or unreachable auth service is not a signed-out user, and
  // redirecting there sends a signed-in user to a sign-in page that cannot
  // work either. The error boundary saying so is the honest answer.
  if (unavailable) throw new Error("Auth service unavailable, try again");
  if (!context) redirect(SIGN_IN_PATH);
  // A management screen a member cannot act on: send them where they can work
  // instead of rendering a page whose every save answers 403.
  if (options.minRole && !roleAtLeast(context.role, options.minRole)) redirect(MEMBER_HOME);
  return withTenant(context, render);
}
