// Host adapter — re-entering the request's tenant from a callback that fires
// after the request handler has returned.
//
// A streaming response outlives the synchronous handler: its flush runs when
// the upstream closes, its cancel when the client hangs up, both driven by the
// runtime piping the body to the socket — outside the request's
// AsyncLocalStorage. Every host usage call in there (`trackPendingRequest`,
// `saveRequestUsage`) reads `currentTenantId()` and would throw
// `TenantContextError`, which surfaced as a "failed to pipe response" crash on
// a mid-stream client abort. Capture the owner while the request context still
// exists, then re-enter it in the callback.
import { tryCurrentTenantId, withTenant } from "@/lib/db/tenant";

/** Runs a later callback under the tenant captured at the call site. */
export type TenantReentry = <T>(fn: () => T) => T;

/**
 * Snapshots the current owner. The returned function re-establishes it around
 * a callback; with no owner in scope (a unit test with no request) it runs the
 * callback as-is, so nothing here forces a tenant that was never set.
 */
export function captureTenant(): TenantReentry {
  const owner: string | null = tryCurrentTenantId();
  return <T>(fn: () => T): T => (owner ? withTenant(owner, fn) : fn());
}
