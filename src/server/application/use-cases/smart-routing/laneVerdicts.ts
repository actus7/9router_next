import "server-only";

import { decideWithJev, type JevQuestion } from "@/server/decisions/jev";
import { handleSingleModelChat } from "@/server/llm-gateway/chat";
import { FLAGSHIP_PATTERN, SMALL_VARIANT_PATTERN } from "@/server/llm-gateway/engine/services/smart-routing/modelIdentity";
import { ROUTING_TIERS, type RoutingTier, type SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";
import type { LaneVerdict } from "@/server/llm-gateway/engine/services/smart-routing/laneAssignment";

/**
 * Who decides the lanes of "Suggest models with AI": Jev first, a chat model
 * when Jev is unavailable, the mechanical rules (assignLanes) when neither
 * answers. The decider sees each model's Artificial Analysis numbers plus where
 * they sit in this inventory and answers 0..1 per lane it is *allowed* to
 * consider (`allowedLanes`) — the role rules (no flagship in Simple, no small
 * variant in Reasoning) hold whoever decides, which is what the earlier LLM
 * classifier lacked. Nothing here throws: a decider that fails is skipped.
 */

export interface LaneCandidate {
  canonicalKey: string;
  model: string;
  displayName: string;
  /** The lanes this model may be offered for — the only ones the decider is asked about. */
  lanes: RoutingTier[];
  facts: Record<string, unknown>;
}

type LaneAnswers = Map<string, Partial<Record<RoutingTier, number>>>;
export type LaneAsker = (batch: LaneCandidate[], context: Record<string, unknown>) => Promise<LaneAnswers | null>;
export interface LaneDeciders {
  jev: LaneAsker;
  llm: LaneAsker | null;
}
export interface LaneDecisionCounts { jev: number; llm: number; rules: number }

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_CONCURRENCY = 3;
const JEV_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 90_000;

const LANE_DEFINITIONS: Record<RoutingTier, string> = {
  simple: "cheap and fast responders for short, direct requests; quality only needs to be acceptable. Never reasoning-focused or top-of-family models.",
  standard: "best cost/quality balance for everyday multi-step work; versatile generalists.",
  complex: "the hardest work, especially code and agentic multi-step tasks; weigh coding/agentic/intelligence indices, higher price and latency are acceptable.",
  reasoning: "only models with real reasoning/thinking strength, for formal logic, math and planning; do not fill the lane just to fill it.",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function modelFacts(profile: SmartModelProfile): Record<string, unknown> {
  const id = profile.model.toLowerCase();
  const small = SMALL_VARIANT_PATTERN.test(id);
  return {
    name: profile.displayName || profile.model,
    measured: Boolean(profile.aa),
    ...(profile.aa ? {
      aa: {
        intelligence: profile.aa.intelligence,
        coding: profile.aa.coding,
        agentic: profile.aa.agentic,
        math: profile.aa.math,
        inputUsdPer1M: profile.aa.inputUsdPer1M,
        outputUsdPer1M: profile.aa.outputUsdPer1M,
        tokensPerSecond: profile.aa.outputTokensPerSecond,
        ttftSeconds: profile.aa.ttftSeconds,
      },
    } : {}),
    smallVariant: small,
    familyFlagship: !small && FLAGSHIP_PATTERN.test(id),
    reasoningCapable: profile.capabilities.reasoning,
    toolCalling: profile.capabilities.tools,
    contextWindow: profile.capabilities.contextWindow,
    rulesScores: profile.laneScores ?? {},
  };
}

/** One candidate per canonical model — five providers of one model are asked about once. */
export function buildCandidates(board: SmartModelProfile[], allowed: ReadonlyMap<string, RoutingTier[]>): LaneCandidate[] {
  const byKey = new Map<string, SmartModelProfile>();
  for (const profile of board) {
    const key = profile.canonicalKey;
    if (!key) continue;
    const kept = byKey.get(key);
    if (!kept || (!kept.aa && profile.aa)) byKey.set(key, profile);
  }
  return [...byKey].flatMap(([canonicalKey, profile]) => {
    const lanes = allowed.get(canonicalKey) ?? [];
    return lanes.length === 0 ? [] : [{ canonicalKey, model: profile.model, displayName: profile.displayName || profile.model, lanes, facts: modelFacts(profile) }];
  });
}

function quantiles(values: number[]): Record<string, number> | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))];
  return { min: sorted[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: sorted[sorted.length - 1] };
}

/** Where the numbers sit in this inventory, so a decider reads them relatively, not absolutely. */
function inventoryContext(board: SmartModelProfile[]): Record<string, unknown> {
  const metric = (pick: (aa: NonNullable<SmartModelProfile["aa"]>) => number | null) =>
    quantiles(board.flatMap((profile) => (profile.aa && finite(pick(profile.aa)) ? [pick(profile.aa) as number] : [])));
  return {
    models: board.length,
    intelligence: metric((aa) => aa.intelligence),
    coding: metric((aa) => aa.coding),
    agentic: metric((aa) => aa.agentic),
    outputUsdPer1M: metric((aa) => aa.outputUsdPer1M),
    tokensPerSecond: metric((aa) => aa.outputTokensPerSecond),
    lanes: LANE_DEFINITIONS,
  };
}

function clampAnswers(batch: LaneCandidate[], raw: LaneAnswers): LaneAnswers {
  const clean: LaneAnswers = new Map();
  for (const candidate of batch) {
    const said = raw.get(candidate.canonicalKey);
    if (!said) continue;
    const lanes: Partial<Record<RoutingTier, number>> = {};
    for (const tier of candidate.lanes) {
      const value = said[tier];
      if (finite(value)) lanes[tier] = Math.max(0, Math.min(1, value));
    }
    if (Object.keys(lanes).length > 0) clean.set(candidate.canonicalKey, lanes);
  }
  return clean;
}

async function attempt(ask: LaneAsker, batch: LaneCandidate[], context: Record<string, unknown>): Promise<LaneAnswers | null> {
  try {
    const answers = await ask(batch, context);
    if (!answers) return null;
    const clean = clampAnswers(batch, answers);
    return clean.size > 0 ? clean : null;
  } catch {
    return null;
  }
}

/**
 * Jev, then the LLM, then nothing (the caller keeps the mechanical lanes for
 * whoever is left). A decider that fails once is not asked again this run: a
 * dead key or an unreachable gateway would otherwise cost one timeout per batch.
 */
export async function decideLaneVerdicts(
  board: SmartModelProfile[],
  allowed: ReadonlyMap<string, RoutingTier[]>,
  deciders: LaneDeciders,
  options: { batchSize?: number; concurrency?: number } = {},
): Promise<{ verdicts: Map<string, LaneVerdict>; counts: LaneDecisionCounts }> {
  const candidates = buildCandidates(board, allowed);
  const context = inventoryContext(board);
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const batches: LaneCandidate[][] = [];
  for (let offset = 0; offset < candidates.length; offset += batchSize) batches.push(candidates.slice(offset, offset + batchSize));

  const verdicts = new Map<string, LaneVerdict>();
  const counts: LaneDecisionCounts = { jev: 0, llm: 0, rules: 0 };
  let jevDown = false;
  let llmDown = deciders.llm === null;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const batch = batches[next++];
      let source: "jev" | "llm" = "jev";
      let answers = jevDown ? null : await attempt(deciders.jev, batch, context);
      if (!answers) {
        jevDown = true;
        source = "llm";
        answers = llmDown || !deciders.llm ? null : await attempt(deciders.llm, batch, context);
        if (!answers) llmDown = true;
      }
      for (const candidate of batch) {
        const lanes = answers?.get(candidate.canonicalKey);
        if (lanes) {
          verdicts.set(candidate.canonicalKey, { source, lanes });
          counts[source] += 1;
        } else {
          counts.rules += 1;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, batches.length || 1)) }, worker));
  return { verdicts, counts };
}

// ── Real deciders ───────────────────────────────────────────────────────────

const questionId = (index: number, tier: RoutingTier) => `m${index}_${tier}`;

const jevAsker: LaneAsker = async (batch, context) => {
  const questions: Record<string, JevQuestion> = {};
  batch.forEach((candidate, index) => {
    for (const tier of candidate.lanes) {
      questions[questionId(index, tier)] = {
        type: "boolean",
        instructions: `Should model m${index} serve the ${tier.toUpperCase()} lane of a production router? Lane: ${LANE_DEFINITIONS[tier]} Judge from its Artificial Analysis numbers relative to the inventory; measured numbers outweigh family reputation.`,
      };
    }
  });
  const state = { inventory: context, models: batch.map((candidate, index) => ({ id: `m${index}`, ...candidate.facts })) };
  const decision = await decideWithJev("suggestRouting", state, questions, { timeoutMs: JEV_TIMEOUT_MS });
  if (!decision) return null;
  const answers: LaneAnswers = new Map();
  batch.forEach((candidate, index) => {
    const lanes: Partial<Record<RoutingTier, number>> = {};
    for (const tier of candidate.lanes) {
      const answer = decision.answers[questionId(index, tier)];
      if (answer?.type === "boolean") lanes[tier] = answer.probability;
    }
    answers.set(candidate.canonicalKey, lanes);
  });
  return answers;
};

function responseText(payload: unknown): string {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
  if (typeof message?.content === "string") return message.content;
  const blocks = Array.isArray(root.content) ? root.content : [];
  const text = (blocks[0] as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text : "";
}

/** Reads `[{id, lanes:{simple:0..1,...}}]` from free-form model output, fences or not. */
export function parseLlmAnswers(text: string, batch: LaneCandidate[]): LaneAnswers | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    const answers: LaneAnswers = new Map();
    for (const item of parsed) {
      const row = (item && typeof item === "object" ? item : {}) as { id?: unknown; lanes?: unknown };
      const index = typeof row.id === "string" ? Number(row.id.replace(/^m/, "")) : Number.NaN;
      const candidate = Number.isInteger(index) ? batch[index] : undefined;
      if (!candidate || !row.lanes || typeof row.lanes !== "object") continue;
      const lanes: Partial<Record<RoutingTier, number>> = {};
      for (const tier of ROUTING_TIERS) {
        const value = (row.lanes as Record<string, unknown>)[tier];
        if (finite(value)) lanes[tier] = value;
      }
      answers.set(candidate.canonicalKey, lanes);
    }
    return answers.size > 0 ? answers : null;
  } catch {
    return null;
  }
}

/** The account's best balanced chat model — good and cheap enough to classify an inventory. */
export function chooseLaneClassifier(board: SmartModelProfile[]): SmartModelProfile | null {
  return board
    .filter((profile) => profile.capabilities.serviceKinds.includes("llm"))
    .sort((a, b) => (b.laneScores?.standard ?? 0) - (a.laneScores?.standard ?? 0))[0] ?? null;
}

function llmAskerFor(classifier: SmartModelProfile): LaneAsker {
  return async (batch, context) => {
    const prompt = [
      "You assign AI models to the lanes of a production router. Return JSON only: an array with one object per model, shaped {\"id\":\"m0\",\"lanes\":{\"<lane>\":0..1}}.",
      "Each number is how well the model fits that lane (0 = not at all, 1 = ideal). Answer only for the lanes listed per model.",
      "Lanes: " + JSON.stringify(LANE_DEFINITIONS),
      "Artificial Analysis numbers are measurements (indices 0-100, USD per 1M tokens, tokens/s, TTFT seconds): they outweigh family reputation. Judge them relative to the inventory quartiles.",
      `Inventory: ${JSON.stringify(context)}`,
      `Models: ${JSON.stringify(batch.map((candidate, index) => ({ id: `m${index}`, lanes: candidate.lanes, ...candidate.facts })))}`,
    ].join("\n");
    const body: Record<string, unknown> = {
      model: classifier.modelKey,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 4_000,
      stream: false,
    };
    const rawRequest = { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json", "x-router-internal": "lane-suggestion" } };
    const call = handleSingleModelChat(body, classifier.modelKey, rawRequest, null, null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_TIMEOUT_MS));
    const response = await Promise.race([call, timeout]);
    if (!response || !response.ok) return null;
    return parseLlmAnswers(responseText(await response.json()), batch);
  };
}

export function defaultLaneDeciders(board: SmartModelProfile[]): LaneDeciders {
  const classifier = chooseLaneClassifier(board);
  return { jev: jevAsker, llm: classifier ? llmAskerFor(classifier) : null };
}
