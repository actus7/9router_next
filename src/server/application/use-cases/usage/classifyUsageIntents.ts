import "server-only";

import { getAdapter } from "@/lib/db/driver";
import { currentTenantId } from "@/lib/db/tenant";
import { parseJson } from "@/lib/db/helpers/jsonCol";
import { setTenantMeta } from "@/lib/db/helpers/tenantMeta";
import { getRequestDetails } from "@/lib/db/repos/requestDetailsRepo";
import { decideWithJev, type JevQuestion } from "@/server/decisions/jev";
import type { RouteNeed } from "@/server/llm-gateway/smart-routing";

// The judge's wording, copied from routingClassifier.ts (which imports nothing
// from here): the same criteria everywhere a need goes to Jev, and neither
// module may depend on the other. Same copy as the suggest/inventory callers.
const JEV_NEED_CRITERIA: Record<RouteNeed, string> = {
  general: "General conversation or writing with no special capability",
  vision: "Understanding an attached image",
  tool_use: "Calling tools or functions",
  coding: "Writing, reviewing or debugging code",
  data_analysis: "Analysing tables, numbers or datasets",
  web_search: "Needs fresh information searched on the web",
  web_fetch: "Needs to read a specific URL",
  image_generation: "Create or edit an image",
  video_generation: "Create a video",
  tts: "Turn text into speech",
  stt: "Transcribe audio",
  embeddings: "Produce vector embeddings",
  email_management: "Read, write or organise email",
  calendar_management: "Read or change calendar events",
  social_media: "Draft or manage social media posts",
  trading: "Market data, trading or finance operations",
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const JEV_BATCH = 40;
const JEV_MIN_CONFIDENCE = 0.7;
const JEV_TIMEOUT_MS = 10_000;
const ITEM_TEXT_CHARS = 400;

/** Where the intent rollup is kept; see the note on the write below. */
export const USAGE_INTENTS_META_KEY = "usageIntents";

/** What one eligible row says about itself. The prompt text is the signal. */
interface UsageItem {
  text?: string;
  model?: string;
  tier?: string;
  need?: string;
}

export interface UsageIntentsSnapshot {
  [key: string]: number | string;
  /** When this rollup was computed. */
  classifiedAt: string;
  /** How many rows landed a counted intent. */
  classified: number;
}

export interface ClassifyUsageIntentsResult {
  classified: number;
  /** Absent when nothing was classified (fail-open: no write happened). */
  usageIntents?: UsageIntentsSnapshot;
}

export interface ClassifyUsageIntentsOptions {
  limit?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The user's last message out of a requestDetails `request.messages` payload. */
function lastUserText(request: Record<string, unknown>): string | undefined {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (message.role !== "user") continue;
    const content = message.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((part) => (typeof part === "string" ? part : typeof record(part).text === "string" ? String(record(part).text) : ""))
        .join(" ");
    }
    text = text.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, ITEM_TEXT_CHARS) : undefined;
  }
  return undefined;
}

/**
 * The text-bearing rows, newest first.
 *
 * `usageHistory` — the always-written table — keeps no prompt text at all (its
 * `meta` only carries the compact routing summary), so the only durable text is
 * in `requestDetails`: opt-in via `enableObservability`/`ENABLE_REQUEST_LOGS`
 * and pruned to `observabilityMaxRecords`. Rows without a user message are not
 * eligible — there is nothing to judge the intent from.
 */
async function requestDetailItems(limit: number): Promise<UsageItem[]> {
  const { details } = await getRequestDetails({ pageSize: limit });
  const items: UsageItem[] = [];
  for (const detail of details) {
    const request = record(detail.request);
    const text = lastUserText(request);
    if (!text) continue;
    const routing = record(request.routing);
    items.push({
      text,
      ...(typeof detail.model === "string" ? { model: detail.model } : {}),
      ...(typeof routing.tier === "string" ? { tier: routing.tier } : {}),
      ...(typeof routing.need === "string" ? { need: routing.need } : {}),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/**
 * The no-text fallback: what `usageHistory` actually allows. Its `meta.routing`
 * summary holds model/tier/combo but NOT the routed need, so this state is
 * coarse (a model name and a tier) and the classification is correspondingly a
 * guess — kept only so an account with observability off still gets a rollup.
 */
async function usageHistoryItems(limit: number): Promise<UsageItem[]> {
  const db = await getAdapter();
  const rows = (await db.all(
    `SELECT model, meta FROM usageHistory WHERE userId = ? ORDER BY id DESC LIMIT ?`,
    [currentTenantId(), limit],
  )) as Array<{ model: string | null; meta: string | null }>;
  return rows.map((row) => {
    const meta = record(parseJson<Record<string, unknown>>(row.meta, {}));
    const routing = record(meta.routing);
    return {
      ...(row.model ? { model: row.model } : {}),
      ...(typeof routing.tier === "string" ? { tier: routing.tier } : {}),
      ...(typeof routing.need === "string" ? { need: routing.need } : {}),
    } satisfies UsageItem;
  }).filter((item) => Object.keys(item).length > 0);
}

/**
 * Classifies what recent usage was FOR and stores the counts per intent.
 *
 * Items go to Jev (`usageTaxonomy`) in batches of 40 as one typed choice over
 * `JEV_NEED_CRITERIA` per item — text plus whatever routing context the row
 * kept. Only well-formed choices at confidence >= 0.7 count. Fail-open like
 * every other Jev caller: a silent Jev classifies nothing, `{ classified: 0 }`
 * comes back and nothing is written.
 *
 * The rollup shape is `{ <need>: n, classifiedAt, classified: n }`, keyed
 * `usageIntents`. `usageHistory.meta` — where the routing summary of
 * `summarizeRoutingTrace` lands — is per request and cannot hold one run-wide
 * aggregate, so the snapshot lives in the per-tenant meta store (kv, scope
 * `meta`) instead: the one durable per-account slot that can.
 */
export async function classifyUsageIntents(options: ClassifyUsageIntentsOptions = {}): Promise<ClassifyUsageIntentsResult> {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_LIMIT) : DEFAULT_LIMIT;

  let items = await requestDetailItems(limit);
  if (items.length === 0) items = await usageHistoryItems(limit);
  if (items.length === 0) return { classified: 0 };

  const counts: Record<string, number> = {};
  let classified = 0;
  for (let offset = 0; offset < items.length; offset += JEV_BATCH) {
    const batch = items.slice(offset, offset + JEV_BATCH);
    const state = {
      items: batch.map((item, index) => ({ id: `i${index}`, ...item })),
    };
    const questions: Record<string, JevQuestion> = {};
    for (let index = 0; index < batch.length; index += 1) {
      questions[`i${index}`] = {
        type: "choice",
        instructions: "What was the user trying to get done with this request? Judge from the text and the routing context.",
        criteria: JEV_NEED_CRITERIA,
      };
    }
    const decision = await decideWithJev("usageTaxonomy", state, questions, { timeoutMs: JEV_TIMEOUT_MS });
    if (!decision) continue;
    for (let index = 0; index < batch.length; index += 1) {
      const answer = decision.answers[`i${index}`];
      if (!answer || answer.type !== "choice" || answer.confidence < JEV_MIN_CONFIDENCE) continue;
      if (!Object.hasOwn(JEV_NEED_CRITERIA, answer.choice)) continue;
      counts[answer.choice] = (counts[answer.choice] ?? 0) + 1;
      classified += 1;
    }
  }
  if (classified === 0) return { classified: 0 };

  const usageIntents: UsageIntentsSnapshot = { ...counts, classifiedAt: new Date().toISOString(), classified };
  const db = await getAdapter();
  await setTenantMeta(db, USAGE_INTENTS_META_KEY, JSON.stringify(usageIntents));
  return { classified, usageIntents };
}
