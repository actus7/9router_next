"use server";

import { HttpValidationError } from "@/server/application/http/requestBody";
import { currentUserId } from "@/server/application/http/tenantRoute";
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
  const userId: string | null = await currentUserId();
  if (!userId) {
    throw new HttpValidationError("Unauthorized", 401, "UNAUTHORIZED");
  }
  return withTenant(userId, run);
}
