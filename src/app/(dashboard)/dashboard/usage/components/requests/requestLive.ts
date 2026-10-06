/** How often the live list re-reads page 1. Neon is shared, so keep it modest. */
export const LIVE_REFRESH_MS = 2000;

/** Ids newer than the last one seen; null (first load) flags nothing. */
export function findNewRequestIds(lastSeenId: number | null, rows: ReadonlyArray<{ id: number }>): Set<number> {
  if (lastSeenId === null) return new Set();
  return new Set(rows.filter((row) => row.id > lastSeenId).map((row) => row.id));
}

/** Live polling only makes sense where new rows appear (page 1) and nothing is being read. */
export function shouldPollRequests(state: { live: boolean; page: number; drawerOpen: boolean }): boolean {
  return state.live && state.page === 1 && !state.drawerOpen;
}
