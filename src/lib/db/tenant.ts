import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who owns the rows a query is allowed to see.
 *
 * Every table except `_meta` carries a `userId`, and every repo filters on it.
 * The id is threaded through an AsyncLocalStorage rather than a parameter
 * because the alternative is adding an argument to ~200 repo functions and
 * every one of their call sites — a diff large enough that the one place
 * someone forgets to pass it becomes a cross-tenant read nobody reviews.
 *
 * There are exactly two places a tenant is established, and both are entry
 * points, never business logic:
 *
 *   - a dashboard request, from the Neon Auth session (`withTenantFromSession`)
 *   - a gateway request, from the owner of the API key it authenticated with
 *
 * ponytail: tenant is the Neon Auth user id, not an organization. Teams need
 * an org id here instead; that is a change to this resolver and the `userId`
 * values written, not to any repo.
 */
const storage: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();

/** Runs `fn` with `userId` as the owner of every query inside it. */
export function withTenant<T>(userId: string, fn: () => T): T {
  if (!userId) throw new TenantContextError("withTenant called with an empty user id");
  return storage.run(userId, fn);
}

/**
 * Raised when tenant-scoped data is reached with no owner established.
 *
 * Deliberately an error and not a silent empty result: a missing context means
 * a code path that never set one, and answering it with "no rows" hides the
 * bug until the day the same path answers with someone else's rows.
 */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

/** The current owner. Throws when there is none — see `TenantContextError`. */
export function currentTenantId(): string {
  const id: string | undefined = storage.getStore();
  if (!id) {
    throw new TenantContextError(
      "No tenant in context. Tenant-scoped data was reached outside a request " +
      "that established one — wrap the entry point in withTenant().",
    );
  }
  return id;
}

/** The current owner, or null. For code that legitimately runs unscoped. */
export function tryCurrentTenantId(): string | null {
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
export function __setTenantForTesting(userId: string): void {
  if (!userId) throw new TenantContextError("__setTenantForTesting called with an empty user id");
  storage.enterWith(userId);
}

