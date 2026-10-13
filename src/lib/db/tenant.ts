import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who owns the rows a query is allowed to see, and who is asking.
 *
 * Every table except `_meta` carries a `userId`, and every repo filters on it.
 * Despite the column name, that value is the **tenant** id: an organization.
 * A personal workspace is an organization whose id is the user's own id, which
 * is why every row written before organizations existed already belongs to the
 * right tenant with no data migration (see
 * docs/superpowers/specs/2026-10-12-multi-tenant-orgs-design.md).
 *
 * The id is threaded through an AsyncLocalStorage rather than a parameter
 * because the alternative is adding an argument to ~200 repo functions and
 * every one of their call sites — a diff large enough that the one place
 * someone forgets to pass it becomes a cross-tenant read nobody reviews.
 *
 * The tenant is established only at entry points, never in business logic:
 *
 *   - a dashboard request, from the Neon Auth session and its active org
 *   - a gateway request, from the API key (org) and the member who owns it
 *   - a background job, once per tenant (`forEachTenant`)
 */

/** A member's role in the tenant, as Neon Auth's organization plugin names it. */
export type TenantRole = "owner" | "admin" | "member";

export interface TenantContext {
  /** The organization whose rows this request reads and writes. */
  tenantId: string;
  /** The person acting. Private rows (conversations, personal memory) are filed under it. */
  actorUserId: string;
  role: TenantRole;
}

const storage: AsyncLocalStorage<TenantContext> = new AsyncLocalStorage<TenantContext>();

const ROLE_RANK: Record<TenantRole, number> = { member: 0, admin: 1, owner: 2 };

/** Whether `role` is at least `minimum`. */
export function roleAtLeast(role: TenantRole, minimum: TenantRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Runs `fn` as `owner`.
 *
 * A bare id means "this tenant acting as itself": the personal-workspace owner,
 * or a background job that belongs to no person. Anything that re-enters a
 * request's scope later (a stream callback, a durable run) must pass the
 * captured `TenantContext` instead — re-entering with the bare id would turn a
 * member into the owner of the organization.
 */
export function withTenant<T>(owner: string | TenantContext, fn: () => T): T {
  const context: TenantContext =
    typeof owner === "string" ? { tenantId: owner, actorUserId: owner, role: "owner" } : owner;
  if (!context.tenantId) throw new TenantContextError("withTenant called with an empty tenant id");
  if (!context.actorUserId) throw new TenantContextError("withTenant called with an empty actor id");
  return storage.run(context, fn);
}

/**
 * Raised when tenant-scoped data is reached with no owner established.
 *
 * Deliberately an error and not a silent empty result: a missing context means
 * a code path that never set one, and answering it with "no rows" hides the
 * bug until the day the same path answers with someone else's rows.
 */
class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

/** The whole context. Throws when there is none — see `TenantContextError`. */
export function currentTenantContext(): TenantContext {
  const context: TenantContext | undefined = storage.getStore();
  if (!context) {
    throw new TenantContextError(
      "No tenant in context. Tenant-scoped data was reached outside a request " +
      "that established one — wrap the entry point in withTenant().",
    );
  }
  return context;
}

/** The current tenant (organization). Throws when there is none. */
export function currentTenantId(): string {
  return currentTenantContext().tenantId;
}

/** The person acting in the current request. Throws when there is none. */
export function currentActorUserId(): string {
  return currentTenantContext().actorUserId;
}

/** The current tenant, or null. For code that legitimately runs unscoped. */
export function tryCurrentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

/** The current context, or null. For code that captures it to re-enter later. */
export function tryCurrentTenantContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

/**
 * Establishes a tenant for the rest of the current execution.
 *
 * Test setup only, where there is no request to wrap and no React runtime.
 * Production code uses `withTenant`: `enterWith` mutates the current context,
 * which propagates in plain Node but is discarded when React resumes a Server
 * Component or Server Action under a context snapshot it captured earlier.
 * That cost a round of `TenantContextError` on every dashboard page; the
 * callback form is the only one that holds everywhere.
 */
export function __setTenantForTesting(owner: string | TenantContext): void {
  const context: TenantContext =
    typeof owner === "string" ? { tenantId: owner, actorUserId: owner, role: "owner" } : owner;
  if (!context.tenantId) throw new TenantContextError("__setTenantForTesting called with an empty tenant id");
  storage.enterWith(context);
}

/**
 * The `WHERE` slot for a table whose rows belong to one member of the tenant:
 * conversations, their events, runs and search index, and personal memory.
 * Pair it with `memberRowParams()`.
 *
 * A row with no `ownerUserId` was written before teams, by the personal
 * workspace's owner — whose id is the tenant id, hence the COALESCE. No
 * backfill: the owner keeps seeing their history, and nobody else ever does.
 */
export const MEMBER_ROWS = "userId = ? AND COALESCE(ownerUserId, userId) = ?";

/** The params for `MEMBER_ROWS`: the tenant, then the acting member. */
export function memberRowParams(): [string, string] {
  const context = currentTenantContext();
  return [context.tenantId, context.actorUserId];
}
