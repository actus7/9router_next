import { connection } from "next/server";

/**
 * Marks the current route as request-time dynamic under Cache Components.
 * Call before reading cookies, DB, request.url, or other unstable runtime data.
 * No-ops outside a Next.js request scope (e.g. Vitest unit tests).
 */
// Only "`connection` was called outside a request scope" is swallowed:
// `connection()` also throws to interrupt prerendering (React postpone,
// static-generation bailout), and swallowing one of those would let a route
// prerender with runtime data instead of opting out. Next ≤16.3 tagged it with
// the code E251; 16.4 throws a plain Error, so the message is what is stable.
const MISSING_REQUEST_SCOPE = /^`connection` was called outside a request scope/;

export async function assertRequestRuntime(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    if (!(error instanceof Error && MISSING_REQUEST_SCOPE.test(error.message))) throw error;
  }
}
