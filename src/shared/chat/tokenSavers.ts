// Token savers the chat can report as having acted on an answer. Shared by the
// gateway (which tags responses), the durable-run worker (which stores them)
// and the chat UI (which renders one pill per id).

export const TOKEN_SAVER_IDS = ["synapse", "rtk", "headroom", "caveman", "ponytail", "pxpipe"] as const;

export type TokenSaverId = (typeof TOKEN_SAVER_IDS)[number];

/** Keeps known ids only, deduplicated, in canonical order. */
export function normalizeTokenSavers(value: unknown): TokenSaverId[] {
  if (!Array.isArray(value)) return [];
  return TOKEN_SAVER_IDS.filter((id) => value.includes(id));
}

export const TOKEN_SAVERS_APPLIED_HEADER = "X-ModelHub-Token-Savers";

/** Ids from a header value, known ids only: the value crosses a process boundary. */
export function readTokenSavers(headers: Headers | null | undefined): TokenSaverId[] {
  const raw = headers?.get(TOKEN_SAVERS_APPLIED_HEADER);
  if (!raw) return [];
  return normalizeTokenSavers(raw.split(",").map((s) => s.trim()));
}
