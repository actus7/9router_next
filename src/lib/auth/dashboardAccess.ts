import { currentUserId } from "@/server/application/http/tenantRoute";

/**
 * Whether the caller may act with an account's authority.
 *
 * `src/proxy.ts` already gates every `/api/*` path on a session cookie being
 * present; this is the layer that verifies it, for handlers that do more than
 * read the caller's own rows — running sandboxed code, editing agent memory,
 * toggling plugins.
 *
 * The old local-single-user escape hatch is gone with `requireLogin`: every row
 * belongs to an account now, so a request with no account has nothing to act on
 * rather than everything.
 */
export async function hasDashboardAccess(): Promise<boolean> {
  return (await currentUserId()) !== null;
}
