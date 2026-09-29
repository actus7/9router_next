// Which token savers actually acted on a request — enabled is not the same as
// used (Synapse only answers trivial turns, RTK only fires on tool output). The
// chat reads this header to show a pill per saver under the answer.
//
// The engine can't import `shared/` (host seam), so the header name is repeated
// in `shared/chat/tokenSavers.ts`, which also validates the ids on the reading
// side; tests/unit/tokenSaversApplied.test.ts keeps the two names equal.

export const TOKEN_SAVERS_APPLIED_HEADER = "X-ModelHub-Token-Savers";

function currentIds(response: Response): string[] {
  return (response.headers.get(TOKEN_SAVERS_APPLIED_HEADER) || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Adds `ids` to the result's response header; no-op for an empty list. */
export function tagTokenSavers<T extends { response?: Response }>(result: T, ids: readonly string[]): T {
  if (!ids.length || !result?.response) return result;
  const merged = [...new Set([...currentIds(result.response), ...ids])].join(",");
  try {
    result.response.headers.set(TOKEN_SAVERS_APPLIED_HEADER, merged);
  } catch {
    // Immutable headers (a fetch Response passed through): rebuild around the same body.
    const headers = new Headers(result.response.headers);
    headers.set(TOKEN_SAVERS_APPLIED_HEADER, merged);
    result.response = new Response(result.response.body, { status: result.response.status, statusText: result.response.statusText, headers });
  }
  return result;
}
