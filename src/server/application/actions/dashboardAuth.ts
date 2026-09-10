"use server";

import { HttpValidationError } from "@/server/application/http/requestBody";
import { resolveCurrentUser } from "@/server/application/http/tenantRoute";
import { withTenant } from "@/lib/db/tenant";

/**
 * Runs a Server Action as the signed-in account.
 *
 * Takes a callback for the same reason `withTenantPage` does: establishing the
 * tenant with `enterWith` and returning does not survive React resuming the
 * action's continuations under an earlier context snapshot, so every repo call
 * after the first `await` threw. `withTenant` scopes it to the callback and is
 * unaffected.
 */
export async function withDashboardSession<T>(run: () => Promise<T>): Promise<T> {
  const { userId, unavailable } = await resolveCurrentUser();
  if (!userId) {
    // Same distinction `tenantRoute` makes: a throttled auth service is not a
    // signed-out user, and 401 for it reads as "your session ended".
    if (unavailable) {
      throw new HttpValidationError("Auth service unavailable, try again", 503, "AUTH_UNAVAILABLE");
    }
    throw new HttpValidationError("Unauthorized", 401, "UNAUTHORIZED");
  }
  return withTenant(userId, run);
}
