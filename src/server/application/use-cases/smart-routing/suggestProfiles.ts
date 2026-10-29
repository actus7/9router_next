import "server-only";

import {
  allowedLanes,
  assignLanes,
  isChatModel,
  ROUTING_TIERS,
  refreshDeterministicSmartProfiles,
  type AaSnapshotMeta,
  type SmartModelProfile,
} from "@/server/llm-gateway/smart-routing";
import { currentTenantContext, withTenant } from "@/lib/db/tenant";
import { decideLaneVerdicts, defaultLaneDeciders, type LaneDecisionCounts } from "./laneVerdicts";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { resolveProviderId } from "@/shared/constants/providers";
import { staticTargetFormat } from "@/server/llm-gateway/engine/services/modelParams";
import { laneParamHints } from "@/server/llm-gateway/engine/services/smart-routing/laneParamHints";
import { enrichProfilesWithAa, syncAaSnapshotIfStale } from "./artificialAnalysis";

/**
 * "Suggest models with AI": the orchestration behind
 * POST /api/smart-routing/suggest, streaming progress as NDJSON.
 *
 * The lanes are decided by Jev, with the Artificial Analysis numbers as its
 * input; a chat model takes over when Jev is unavailable; the pure rules
 * (laneAssignment) decide whatever neither answered. The rules always run
 * first: they bound what a decider may choose (role rules hold whoever
 * decides) and are the final fallback. The earlier LLM classifier failed
 * because nothing bounded it and it overrode measurements; see laneVerdicts.
 *
 * Stream contract (one JSON object per `\n`-terminated line, in this order):
 *   {"type":"phase","phase":"aa-sync"}
 *   {"type":"phase","phase":"inventory","total":n,"llmEligible":n}
 *   {"type":"phase","phase":"decide"}
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
  decision: LaneDecisionCounts;
  aaMeta: (AaSnapshotMeta & { matchedCount: number }) | null;
}

type SuggestStreamEvent =
  | { type: "phase"; phase: "aa-sync" }
  | { type: "phase"; phase: "inventory"; total: number; llmEligible: number }
  | { type: "phase"; phase: "decide" }
  | { type: "done"; payload: SuggestDonePayload }
  | { type: "error"; message: string };

export const SUGGESTION_SOURCE = "artificial-analysis";

/** An error message fit for the wire: no braces, so no JSON fragment leaks. */
function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const cleaned = message.replace(/[{}]/g, "").trim();
  return cleaned || "Failed to suggest model profiles";
}

/**
 * What the board needs besides the lanes: per lane, the reasoning parameters
 * the model's catalog supports, and the provider's accounts so a model on
 * several of them can be offered once per account. Pure rules, no decider.
 */
export async function withEntryHints(profiles: SmartModelProfile[]): Promise<SmartModelProfile[]> {
  const connections = await getProviderConnections({ isActive: true });
  const byProvider = new Map<string, typeof connections>();
  for (const connection of connections) {
    const key = resolveProviderId(String(connection.provider));
    byProvider.set(key, [...(byProvider.get(key) ?? []), connection]);
  }
  return profiles.map((profile) => {
    const accounts = byProvider.get(resolveProviderId(profile.provider)) ?? [];
    const subscription = accounts.some((account) => account.authType === "oauth");
    const laneParams: NonNullable<SmartModelProfile["laneParams"]> = {};
    for (const tier of ROUTING_TIERS) {
      if (typeof profile.laneScores?.[tier] !== "number") continue;
      const hints = laneParamHints(profile.model, tier, { subscription, targetFormat: staticTargetFormat(resolveProviderId(profile.provider), profile.model) });
      if (hints) laneParams[tier] = hints;
    }
    return {
      ...profile,
      ...(Object.keys(laneParams).length > 0 ? { laneParams } : {}),
      ...(accounts.length > 1 ? { accountIds: accounts.map((account) => account.id) } : {}),
    };
  });
}

/** The inventory the board routes general chat to (see runSuggest). */
export function chatEligibleProfiles(inventory: SmartModelProfile[]): SmartModelProfile[] {
  return inventory.filter((profile) => (
    profile.capabilities.serviceKinds.includes("llm") && isChatModel(profile.model) && isChatModel(profile.displayName)
  ));
}

async function* runSuggest(only?: string[]): AsyncGenerator<Uint8Array> {
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
    // A combo restricted to chosen models spreads only those: lanes are
    // percentiles of what is ranked, so the rest of the inventory must not count.
    const allowed = only ? new Set(only) : null;
    const chat = chatEligibleProfiles(allowed ? inventory.filter((profile) => allowed.has(profile.modelKey)) : inventory);
    const enriched = enrichProfilesWithAa(chat, aa);
    yield emit({ type: "phase", phase: "inventory", total: inventory.length, llmEligible: chat.length });
    if (enriched.profiles.length === 0) {
      yield emit({ type: "error", message: "No active chat models to suggest" });
      return;
    }

    const mechanical = assignLanes(enriched.profiles);
    yield emit({ type: "phase", phase: "decide" });
    const { verdicts, counts } = await decideLaneVerdicts(mechanical, allowedLanes(enriched.profiles), defaultLaneDeciders(mechanical));
    const profiles = await withEntryHints(verdicts.size > 0 ? assignLanes(enriched.profiles, verdicts) : mechanical);
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
        decision: counts,
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
export function streamSuggestSuggestions(only?: string[]): ReadableStream<Uint8Array> {
  // Captured here, inside tenantRoute's scope. The generator below resumes
  // after every await from the stream's consumer, where the ambient tenant is
  // whoever happens to be reading — so the work is re-scoped to the account
  // that opened the stream, the way usage/stream does it.
  const owner = currentTenantContext();
  const events = runSuggest(only);
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
