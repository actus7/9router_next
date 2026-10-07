import "server-only";

import { refreshDeterministicSmartProfiles } from "@/server/llm-gateway/smart-routing";
import { enrichProfilesWithAa, forceSyncAaSnapshot } from "./artificialAnalysis";
import { chatEligibleProfiles } from "./suggestProfiles";

/**
 * The "Sync now" button behind POST /api/smart-routing/aa-sync: refetch the
 * Artificial Analysis snapshot and report it the way a suggestion round does,
 * so the board's "AA sync · matched/total" line can be refreshed in place.
 * `matchedCount` is how many of *our* chat models the snapshot recognizes, not
 * how much was downloaded — a larger fetch only raises it if AA gained rows
 * that our names match.
 */
export async function syncAaNow() {
  const snapshot = await forceSyncAaSnapshot();
  const chat = chatEligibleProfiles(await refreshDeterministicSmartProfiles());
  const { matched } = enrichProfilesWithAa(chat, snapshot);
  return { ...snapshot.meta, matchedCount: matched };
}
