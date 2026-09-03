import { connection } from "next/server";

/**
 * Marks the current route as request-time dynamic under Cache Components.
 * Call before reading cookies, DB, request.url, or other unstable runtime data.
 * No-ops outside a Next.js request scope (e.g. Vitest unit tests).
 */
// Next tags "`connection` was called outside a request scope" with this stable
// code. Matching the code rather than the message matters because `connection()`
// also throws to interrupt prerendering (React postpone, static-generation
// bailout); swallowing one of those by accident would let a route prerender with
// runtime data instead of opting out.
const MISSING_REQUEST_SCOPE_CODE = "E251";

export async function assertRequestRuntime(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    const code = (error as { __NEXT_ERROR_CODE?: unknown } | null)?.__NEXT_ERROR_CODE;
    if (code !== MISSING_REQUEST_SCOPE_CODE) throw error;
  }
}
