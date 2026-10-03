import "server-only";

import {
  assignLanes,
  isChatModel,
  refreshDeterministicSmartProfiles,
  type AaSnapshotMeta,
  type SmartModelProfile,
} from "@/server/llm-gateway/smart-routing";
import { currentTenantId, withTenant } from "@/lib/db/tenant";
import { enrichProfilesWithAa, syncAaSnapshotIfStale } from "./artificialAnalysis";

/**
 * "Suggest models with AI": the orchestration behind
 * POST /api/smart-routing/suggest, streaming progress as NDJSON.
 *
 * The lanes come from Artificial Analysis measurements through pure rules
 * (laneAssignment). This used to be an LLM classifier in batches of 30, a Jev
 * override, a single web search and a per-model cache to amortize all of it;
 * the classifier decided lanes the measurements contradicted, so it went, and
 * everything that existed to feed or amortize it went with it. What is left
 * runs over the whole inventory in milliseconds.
 *
 * Stream contract (one JSON object per `\n`-terminated line, in this order):
 *   {"type":"phase","phase":"aa-sync"}
 *   {"type":"phase","phase":"inventory","total":n,"llmEligible":n}
 *   {"type":"done","payload":{...}}
 *   {"type":"error","message":"..."}  (terminal; nothing follows)
 * The AA sync stays fail-open: without a snapshot every model is estimated.
 */

export interface SuggestDonePayload {
  profiles: SmartModelProfile[];
  /** Tag the confirm endpoint stores as the profiles' classifier. */
  classifierModel: string;
  researchedAt: string;
  /** Chat models the AA snapshot does not cover: their scores are estimates. */
  unmatched: string[];
  totalInventory: number;
  aaMeta: (AaSnapshotMeta & { matchedCount: number }) | null;
}

type SuggestStreamEvent =
  | { type: "phase"; phase: "aa-sync" }
  | { type: "phase"; phase: "inventory"; total: number; llmEligible: number }
  | { type: "done"; payload: SuggestDonePayload }
  | { type: "error"; message: string };

export const SUGGESTION_SOURCE = "artificial-analysis";

/** An error message fit for the wire: no braces, so no JSON fragment leaks. */
function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const cleaned = message.replace(/[{}]/g, "").trim();
  return cleaned || "Failed to suggest model profiles";
}

async function* runSuggest(): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const emit = (event: SuggestStreamEvent): Uint8Array => encoder.encode(`${JSON.stringify(event)}\n`);
  try {
    // Emitted before anything is awaited: the stream answers immediately and
    // the client sees the phase while the AA snapshot is still syncing.
    yield emit({ type: "phase", phase: "aa-sync" });
    const aa = await syncAaSnapshotIfStale();
    const inventory = await refreshDeterministicSmartProfiles();
    // The board routes general chat: TTS voices, image/video models and
    // embeddings must not reach it, whether the provider says so
    // (serviceKinds) or only the model name does (Lyria filed as `llm`).
    const chat = inventory.filter((profile) => (
      profile.capabilities.serviceKinds.includes("llm") && isChatModel(profile.model) && isChatModel(profile.displayName)
    ));
    const enriched = enrichProfilesWithAa(chat, aa);
    yield emit({ type: "phase", phase: "inventory", total: inventory.length, llmEligible: chat.length });
    if (enriched.profiles.length === 0) {
      yield emit({ type: "error", message: "No active chat models to suggest" });
      return;
    }

    const profiles = assignLanes(enriched.profiles);
    const unmatched = [...new Set(enriched.profiles.filter((profile) => !profile.aa).map((profile) => profile.displayName || profile.model))]
      .sort((a, b) => a.localeCompare(b));
    yield emit({
      type: "done",
      payload: {
        profiles,
        classifierModel: SUGGESTION_SOURCE,
        researchedAt: new Date().toISOString(),
        unmatched,
        totalInventory: chat.length,
        aaMeta: aa ? { ...aa.meta, matchedCount: enriched.matched } : null,
      },
    });
  } catch (error) {
    console.error("Error suggesting smart model profiles:", error);
    yield emit({ type: "error", message: sanitizeErrorMessage(error) });
  }
}

/**
 * The NDJSON stream for the suggest endpoint. Everything happens inside the
 * stream so the first phase marker reaches the client before the inventory is
 * even loaded.
 */
export function streamSuggestSuggestions(): ReadableStream<Uint8Array> {
  // Captured here, inside tenantRoute's scope. The generator below resumes
  // after every await from the stream's consumer, where the ambient tenant is
  // whoever happens to be reading — so the work is re-scoped to the account
  // that opened the stream, the way usage/stream does it.
  const owner = currentTenantId();
  const events = runSuggest();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await withTenant(owner, async () => {
          for await (const chunk of events) {
            controller.enqueue(chunk);
          }
        });
      } catch {
        // Consumer went away mid-write; the stream is over either way.
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      }
    },
    cancel() {
      void events.return(undefined);
    },
  });
}
