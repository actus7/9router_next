// Synapse Loop — the Synapse that learns (docs/superpowers/specs/2026-09-28-synapse-loop-design.md).
//
// A short question this account keeps asking, whose answer depends on nothing
// but the question, becomes a capability Synapse answers locally. The rule the
// whole module is built around: a false positive that swallows a real question
// is worse than spending tokens — every gate here fails towards the LLM.
//
// Life cycle: observe → (2 equivalent answers) shadow → (≥10 runs, ≥90% agree)
// active → served; one in `auditEvery` matches still goes to the LLM and is
// compared, and a divergence or a 👎/Regenerate counts as a rejection;
// `maxRejections` retire it.

import { createHash } from "node:crypto";
import {
  bumpCapability,
  createShadowCapability,
  demoteToShadow,
  getCapability,
  insertObservation,
  insertSynapseEvent,
  listCapabilitiesByKey,
  listObservations,
  pruneObservations,
} from "@/lib/db/repos/synapseLoopRepo";
import { evaluateJev } from "@/server/decisions/jev";

export const LOOP_LIMITS = {
  maxInputChars: 120,
  maxAnswerChars: 1500,
  minObservations: 2,
  minShadowRuns: 10,
  minAgreement: 0.9,
  auditEvery: 20,
  maxRejections: 2,
  retentionDays: 30,
  similarity: 0.8,
  jevStable: 0.8,
  jevEquivalent: 0.85,
  jevTimeoutMs: 8000,
} as const;

export interface LoopOptions {
  /** Decision engine is Jev, the account has a key and `jevSynapse` is on. */
  useJev: boolean;
}

// ── key & persona ───────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The capability key for a question, or null when it is not short enough to learn. */
export function learningKey(input: string): string | null {
  const key = normalize(input);
  return key && key.length <= LOOP_LIMITS.maxInputChars ? key : null;
}

// The chat appends the account's skills and memory to the system prompt; they
// change as the account learns, and must not make every turn a new persona.
// Headers written by buildSkillsPromptBlock / buildMemoryPromptBlock
// (src/shared/harness), guarded by tests/unit/synapseLoop.test.ts.
const APPENDED_BLOCK_HEADERS = ["Available Agent Skills (", "Agent memory (", "User memory ("];

/** Hash of the part of the system prompt that shapes answers (the persona). */
export function personaHash(systemText: string | null): string {
  let text = systemText ?? "";
  for (const header of APPENDED_BLOCK_HEADERS) {
    const at = text.indexOf(header);
    if (at >= 0) text = text.slice(0, at);
  }
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

// ── judges ──────────────────────────────────────────────────────────────────

const TIME_BOUND = /\b(hoje|agora|amanha|ontem|atual|atualmente|horas?|horario|data|semana|mes|ano|preco|precos|cotacao|clima|previsao|noticias?|ultim[oa]s?|today|now|tonight|tomorrow|yesterday|current|currently|latest|time|date|price|prices|weather|forecast|news|stock)\b/;
const REFERS_TO_CONVERSATION = /^(e|and|mas|but)\b|\b(isso|esse|essa|este|esta|aquilo|anterior|acima|segundo|terceiro|it|that|this|those|them|previous|above)\b/;
const ABOUT_THE_ASKER = /\b(meu|minha|meus|minhas|eu|mim|comigo|my|mine|me|myself)\b/;
const CLOCK_OR_YEAR = /\b\d{1,2}:\d{2}\b|\b20\d{2}\b/;

/** Conservative: false whenever the answer could depend on anything but the question. */
export function heuristicStable(input: string, answer: string): boolean {
  const q = normalize(input);
  if (TIME_BOUND.test(q) || REFERS_TO_CONVERSATION.test(q) || ABOUT_THE_ASKER.test(q)) return false;
  if (CLOCK_OR_YEAR.test(answer)) return false;
  // A question back is a clarification, not an answer to reuse.
  if (answer.trim().endsWith("?")) return false;
  return true;
}

/** Dice coefficient over the answers' normalized word sets. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

type Verdict = { value: boolean; source: "heuristic" | "jev" };

async function jevBoolean(state: Record<string, unknown>, instructions: string, threshold: number): Promise<boolean | null> {
  const answers = await evaluateJev(state, { q: { type: "boolean", instructions } }, LOOP_LIMITS.jevTimeoutMs);
  const p = (answers?.q as { probability?: number } | undefined)?.probability;
  return typeof p === "number" ? p >= threshold : null;
}

async function isStable(input: string, answer: string, opts: LoopOptions): Promise<boolean> {
  // The heuristic's "no" is final: Jev may only add caution, never remove it.
  if (!heuristicStable(input, answer)) return false;
  if (!opts.useJev) return true;
  const jev = await jevBoolean(
    { question: input, answer },
    "Would this exact answer still be correct and appropriate if anyone asked the same question on any other day, in a new conversation? False if it depends on the current time or date, prices, weather, news, earlier messages, or personal data about the asker.",
    LOOP_LIMITS.jevStable,
  );
  return jev ?? true;
}

async function areEquivalent(question: string, a: string, b: string, opts: LoopOptions): Promise<Verdict> {
  if (opts.useJev) {
    const jev = await jevBoolean(
      { question, answerA: a, answerB: b },
      "Do these two answers give the person who asked the same information, with nothing contradictory between them?",
      LOOP_LIMITS.jevEquivalent,
    );
    if (jev !== null) return { value: jev, source: "jev" };
  }
  return { value: tokenSimilarity(a, b) >= LOOP_LIMITS.similarity, source: "heuristic" };
}

// ── life cycle ──────────────────────────────────────────────────────────────

export interface ObservedTurn {
  input: string;
  systemText: string | null;
  answer: string;
  model: string | null;
}

function retentionCutoff(): string {
  return new Date(Date.now() - LOOP_LIMITS.retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

// A rejection takes the capability out of use immediately — otherwise the
// "Regenerate" that follows a 👎 would get the same local answer back. It
// re-proves itself in shadow; `maxRejections` retire it for good.
async function recordRejection(capId: string, rejectionsSoFar: number, reason: string): Promise<void> {
  const retire = rejectionsSoFar + 1 >= LOOP_LIMITS.maxRejections;
  if (retire) await bumpCapability(capId, { rejections: 1, status: "deprecated" });
  else await demoteToShadow(capId);
  await insertSynapseEvent(capId, retire ? "deprecated" : "rejected", { reason });
}

/**
 * Called after the LLM answered an eligible turn. Feeds a shadow capability,
 * audits an active one, or records an observation that may become one.
 */
export async function observeAnswer(turn: ObservedTurn, opts: LoopOptions): Promise<void> {
  const key = learningKey(turn.input);
  const answer = turn.answer.trim();
  if (!key || !answer || answer.length > LOOP_LIMITS.maxAnswerChars) return;
  const persona = personaHash(turn.systemText);
  const cap = await getCapability(key, persona);

  if (cap?.status === "deprecated") return;

  if (cap?.status === "shadow") {
    const agree = await areEquivalent(turn.input, cap.answer, answer, opts);
    const runs = cap.shadowRuns + 1;
    const agreements = cap.shadowAgreements + (agree.value ? 1 : 0);
    const promote = runs >= LOOP_LIMITS.minShadowRuns && agreements / runs >= LOOP_LIMITS.minAgreement;
    await bumpCapability(cap.id, { shadowRuns: 1, shadowAgreements: agree.value ? 1 : 0, ...(promote ? { status: "active" as const } : {}) });
    await insertSynapseEvent(cap.id, promote ? "promoted" : "shadow_evaluated", { agree: agree.value, runs, agreements });
    return;
  }

  if (cap?.status === "active") {
    // Only an audit turn reaches the LLM while the capability is active.
    const agree = await areEquivalent(turn.input, cap.answer, answer, opts);
    if (agree.value) await insertSynapseEvent(cap.id, "audited", { agree: true });
    else await recordRejection(cap.id, cap.rejections, "audit_diverged");
    return;
  }

  if (!(await isStable(turn.input, answer, opts))) return;
  await insertObservation({ key, personaHash: persona, input: turn.input.trim(), answer, model: turn.model });
  // ponytail: retention swept opportunistically on writes; a cron if volume grows.
  if (Math.random() < 0.02) await pruneObservations(retentionCutoff()).catch(() => undefined);

  // Newest first, so [0] is the observation just written; compare against the rest.
  const recent = await listObservations(key, persona, retentionCutoff(), 6);
  if (recent.length < LOOP_LIMITS.minObservations) return;
  for (const other of recent.slice(1)) {
    const verdict = await areEquivalent(turn.input, other.answer, answer, opts);
    if (!verdict.value) continue;
    const shortest = other.answer.length <= answer.length ? other.answer : answer;
    await createShadowCapability({ key, personaHash: persona, canonicalInput: turn.input.trim(), answer: shortest, source: verdict.source });
    return;
  }
}

/**
 * The learned answer for this turn, or null (send it to the LLM). Every
 * `auditEvery`-th match is deliberately null so the LLM re-checks the answer.
 */
export async function lookupLearned(turn: { input: string; systemText: string | null }): Promise<{ id: string; answer: string } | null> {
  const key = learningKey(turn.input);
  if (!key) return null;
  const cap = await getCapability(key, personaHash(turn.systemText));
  if (!cap || cap.status !== "active") return null;
  const audit = cap.served % LOOP_LIMITS.auditEvery === LOOP_LIMITS.auditEvery - 1;
  await bumpCapability(cap.id, { served: 1 });
  if (audit) return null;
  await insertSynapseEvent(cap.id, "served");
  return { id: cap.id, answer: cap.answer };
}

/** 👎 or "Regenerate" on an answer Synapse served: the chat knows the question, not the persona. */
export async function rejectLearned(input: string): Promise<void> {
  const key = learningKey(input);
  if (!key) return;
  for (const cap of await listCapabilitiesByKey(key)) {
    if (cap.status === "deprecated") continue;
    await recordRejection(cap.id, cap.rejections, "user_rejected");
  }
}
