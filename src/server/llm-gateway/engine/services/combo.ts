/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback";
import { unavailableResponse } from "../utils/error";
import { getCapabilitiesForModel } from "../providers/capabilities";
import type { Logger, ComboEntry, CombosData } from "./types";
import { COMBO_FIRST_BYTE_BUDGET_MS, COMBO_HEDGE_ENABLED, COMBO_TIME_BUDGET_MS, STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig";
import { setAttemptSignal, setFirstByteBudget } from "../utils/firstByteGuard";
import { adaptiveFirstByteBudget, hedgeDelayMs, loadModelStats, recordAttemptDatum } from "../host/modelStats";
import {
  getStickyModel,
  orderByPenalty,
  recordModelFailure,
  recordModelSuccess,
  rememberStickyModel,
} from "./modelPenalty";
import { getRoutingDecision } from "./smart-routing/context";
import { isFreeFallback, recordRoutingStep } from "./routingTrace";
import { truncateTraceError, classifyAttemptError, type AttemptOutcome } from "../host/routingTrace";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);


// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
function reorderByCapabilities(models: string[], required: Set<string> | null | undefined): string[] {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c: string) => HARD_CAPS.has(c));
  const soft = [...required].filter((c: string) => !HARD_CAPS.has(c));

  const tierOf = (m: string): number => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c: string) => (caps as Record<string, unknown>)[c] === true)) return 2;
    return soft.every((c: string) => (caps as Record<string, unknown>)[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  return models
    .map((m: string, i: number) => ({ m, i, t: tierOf(m) }))
    .sort((a: { m: string; i: number; t: number }, b: { m: string; i: number; t: number }) => a.t - b.t || a.i - b.i)
    .map((x: { m: string; i: number; t: number }) => x.m);
}

/** Whether `provider/model` is a reasoning model (may stay silent a long time). */
function isReasoningModel(modelStr: string): boolean {
  const slash = modelStr.indexOf("/");
  const caps = getCapabilitiesForModel(slash > 0 ? modelStr.slice(0, slash) : "", slash > 0 ? modelStr.slice(slash + 1) : modelStr);
  return (caps as Record<string, unknown>).reasoning === true;
}

/** Whether `provider/model` keeps `tools` on the way upstream. */
export function modelSupportsTools(modelStr: string): boolean {
  const slash = modelStr.indexOf("/");
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
  return (getCapabilitiesForModel(provider, model) as Record<string, unknown>).tools !== false;
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map<string, { index: number; consecutiveUseCount: number }>();

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r: string) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role as string)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body: Record<string, unknown>): Set<string> {
  const required = new Set<string>();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime: unknown): void => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b: Record<string, unknown>): void => {
    if (!b || typeof b !== "object") return;
    const t = b.type as string;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      // Infer modality from embedded mime when available; fall back to pdf for generic files.
      let fmime: string | null = null;
      const inputAudio = b.input_audio as Record<string, unknown> | undefined;
      const file = b.file as Record<string, unknown> | undefined;
      const source = b.source as Record<string, unknown> | undefined;
      if (inputAudio?.format) fmime = `audio/${inputAudio.format}`;
      else if (file?.file_data) fmime = String(file.file_data).match(/^data:([^;,]+)/)?.[1] || null;
      else if (source?.media_type) fmime = source.media_type as string;
      else if (source?.data) fmime = String(source.data).match(/^data:([^;,]+)/)?.[1] || null;
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    // gemini parts: inlineData/fileData carry a mime
    const inlineData = b.inlineData as Record<string, unknown> | undefined;
    const fileData = b.fileData as Record<string, unknown> | undefined;
    addByMime(inlineData?.mimeType || fileData?.mimeType);
  };

  const scanContent = (content: unknown): void => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b as Record<string, unknown>);
  };

  const scanMessage = (m: Record<string, unknown>): void => {
    if (!m || typeof m !== "object") return;

    // Ollama / Hermes images array (strings or objects)
    if (Array.isArray(m.images) && m.images.length > 0) {
      required.add("vision");
    }

    // Vercel AI SDK / Hermes attachments / experimental_attachments
    const attachments = m.experimental_attachments || m.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att) continue;
        const attObj = att as Record<string, unknown>;
        const mime = attObj.contentType || attObj.mediaType || (typeof attObj.url === "string" && (attObj.url as string).match(/^data:([^;,]+)/)?.[1]);
        if (mime) addByMime(mime);
        else if (attObj.url || attObj.data) required.add("vision");
      }
    }

    // Direct message-level modality properties
    if (m.image_url || m.image) required.add("vision");
    if (m.audio_url || m.audio) required.add("audioInput");

    // Scan array content blocks
    scanContent(m.content);

    // Scan string content for embedded data URIs
    if (typeof m.content === "string") {
      if (m.content.includes("data:image/")) required.add("vision");
      else if (m.content.includes("data:audio/")) required.add("audioInput");
      else if (m.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages as Record<string, unknown>[])) scanMessage(m);              // openai / claude / hermes / ollama
  for (const it of trailingUserItems(body.input as Record<string, unknown>[])) scanContent((it as Record<string, unknown>).content);       // responses
  const contents = body.contents || (body.request as Record<string, unknown>)?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents as Record<string, unknown>[])) scanContent((c as Record<string, unknown>).parts);

  // search: temporarily disabled in auto-switch (feature not wired yet).

  return required;
}

function normalizeStickyLimit(stickyLimit: unknown): number {
  const parsed = Number.parseInt(String(stickyLimit), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models: string[], currentIndex: number): string[] {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift()!;
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
function getRotatedModels(models: string[], comboName: string, strategy: string, stickyLimit: number | string = 1): string[] {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName?: string): void {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr: string, combosData: ComboEntry[] | CombosData): string[] | null {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find((c: ComboEntry) => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

interface HandleComboChatOptions {
  body: Record<string, unknown>;
  models: string[];
  handleSingleModel: (body: Record<string, unknown>, modelStr: string) => Promise<Response>;
  log: Logger;
  comboName?: string;
  comboStrategy?: string;
  comboStickyLimit?: number | string;
  autoSwitch?: boolean;
  /** Overrides for tests; production reads COMBO_*_BUDGET_MS. */
  comboFirstByteBudgetMs?: number;
  comboTimeBudgetMs?: number;
  /** Opt-in: reorder by recent failures and stick to the model that rescued the chat. */
  adaptive?: boolean;
  /** Conversation identity, for the sticky model. */
  sessionKey?: string;
  /** Per-combo kill switch (comboStrategy.hedge === false). */
  hedge?: boolean;
  /** Process-wide switch; defaults to COMBO_HEDGE_ENABLED. Override for tests. */
  hedgeEnabled?: boolean;
  /** Fixed hedge delay, replacing the one derived from the model's TTFT. Override for tests. */
  comboHedgeDelayMs?: number;
}

/** Extract error text + retryAfter from a non-ok response. */
async function extractResponseError(result: Response): Promise<{ errorText: string; retryAfter: string | null }> {
  let errorText: string = result.statusText || "";
  let retryAfter: string | null = null;
  try {
    const errorBody = await result.clone().json();
    errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
    retryAfter = errorBody?.retryAfter || null;
  } catch {
    // Ignore JSON parse errors
  }
  if (typeof errorText !== "string") {
    try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
  }
  return { errorText, retryAfter };
}

/** Update earliestRetryAfter if the new value is earlier. */
function trackEarliestRetryAfter(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current || new Date(candidate) < new Date(current)) return candidate;
  return current;
}

/** Sticky model first (when it is still a member), then the penalty order. */
function orderAdaptively(models: string[], comboName: string, sessionKey: string | undefined): string[] {
  const sticky = getStickyModel(sessionKey, comboName);
  const rest = sticky && models.includes(sticky) ? models.filter((m) => m !== sticky) : models;
  const ordered = orderByPenalty(rest);
  return rest === models ? ordered : [sticky!, ...ordered];
}

/** One line per model the loop tried, so "all failed" says who failed and why. */
function describeAttempts(attempts: AttemptDigest[]): string {
  return attempts.map((a) => `${a.model} (${a.label})`).join(", ");
}

interface AttemptDigest { model: string; label: string }

/** Build the final "all models failed" response. */
function buildAllFailedResponse(lastError: string | null, lastStatus: number | null, earliestRetryAfter: string | null, log: Logger, attempts: AttemptDigest[] = []): Response {
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const base = lastError || "All combo models unavailable";
  const msg = attempts.length > 1 ? `${base} — tried ${describeAttempts(attempts)}` : base;

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn?.("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn?.("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/** One hedge: who won, and how to stop the attempt that did not. */
interface HedgeRace {
  /** The attempt that opened the race; only it may end the race with a request-level error. */
  primary: number;
  winner: number | null;
  controllers: Map<number, AbortController>;
}

/** The first attempt to hand back a response wins; the others are aborted. */
function claimRace(race: HedgeRace, attempt: number): boolean {
  if (race.winner === null) {
    race.winner = attempt;
    for (const [other, controller] of race.controllers) if (other !== attempt) controller.abort();
  }
  return race.winner === attempt;
}

/** First non-null response; null once every attempt has settled without one. */
function firstResponse(attempts: Promise<Response | null>[]): Promise<Response | null> {
  return new Promise((resolve) => {
    let pending = attempts.length;
    const settle = (response: Response | null): void => {
      if (response) resolve(response);
      else if (--pending === 0) resolve(null);
    };
    for (const attempt of attempts) attempt.then(settle, () => settle(null));
  });
}

/** Close the stream of an attempt that lost, so its upstream is not read (or paid for) any further. */
function discardResponse(response: Response | undefined): void {
  response?.body?.cancel().catch(() => {});
}

const HEDGE_DUE = Symbol("hedge-due");

/**
 * Handle combo chat with fallback
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true, comboFirstByteBudgetMs, comboTimeBudgetMs, adaptive = false, sessionKey, hedge = true, hedgeEnabled = COMBO_HEDGE_ENABLED, comboHedgeDelayMs }: HandleComboChatOptions): Promise<Response> {
  let rotatedModels = getRotatedModels(models, comboName || "", comboStrategy || "fallback", comboStickyLimit);

  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    // Soft, and added here rather than in detectRequiredCapabilities (which
    // also drives the capacity adapter): a provider that drops `tools` moves
    // behind every one that keeps them, but stays as the prose-only last resort
    // — the same call `retryWithoutTools` makes.
    if (Array.isArray(body.tools) && body.tools.length > 0) required.add("tools");
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info?.("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }

  const stickyModel = adaptive ? getStickyModel(sessionKey, comboName || "") : undefined;
  if (adaptive) rotatedModels = orderAdaptively(rotatedModels, comboName || "", sessionKey);

  let lastError: string | null = null;
  let earliestRetryAfter: string | null = null;
  let lastStatus: number | null = null;
  const digest: AttemptDigest[] = [];
  const loopStartedAt = Date.now();
  const baseFirstByteBudgetMs = comboFirstByteBudgetMs ?? COMBO_FIRST_BYTE_BUDGET_MS;
  // Measured history sizes each model's patience; with no store it is the base.
  const modelStats = rotatedModels.length > 1 ? await loadModelStats() : new Map();
  const timeBudgetMs = comboTimeBudgetMs ?? COMBO_TIME_BUDGET_MS;
  // Only a streaming answer has a "first byte" to race for.
  const canHedge = hedge && hedgeEnabled && body.stream === true;

  const selectModel = (modelStr: string): void => {
    const routingDecision = getRoutingDecision(body);
    if (!routingDecision) return;
    const candidate = routingDecision.candidateDetails.find((item) => item.model === modelStr);
    routingDecision.selectedModel = modelStr;
    if (candidate) routingDecision.degraded = candidate.degraded;
  };

  /**
   * How long attempt `i` may stay silent after headers. A model with no one
   * behind it, or one that thinks silently on purpose, keeps today's patience:
   * failing it over would trade a good answer for a worse one. Inside a hedge
   * the guard is still armed (long) so that "answered" means "sent a byte".
   */
  const firstByteBudgetFor = (i: number, hedged: boolean): number | undefined => {
    const modelStr = rotatedModels[i];
    const patient = i === rotatedModels.length - 1 || isReasoningModel(modelStr);
    if (patient) return hedged ? STREAM_FIRST_CHUNK_TIMEOUT_MS : undefined;
    return adaptiveFirstByteBudget(baseFirstByteBudgetMs, modelStats.get(modelStr));
  };

  /** One attempt. A response means "return this"; null means "try the next". Never throws. */
  const runAttempt = async (i: number, race?: HedgeRace): Promise<Response | null> => {
    const modelStr = rotatedModels[i];
    selectModel(modelStr);
    log.info?.("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    // Hedged attempts run side by side, so each gets its own copy (budget and
    // abort signal). The routing trace and decision ride along by reference.
    const attemptBody: Record<string, unknown> = race ? { ...body } : body;
    const signal = race?.controllers.get(i)?.signal;
    if (signal) setAttemptSignal(attemptBody, signal);

    const startedAt = Date.now();
    const traceStep = (outcome: AttemptOutcome, extra: { status?: number; error?: string } = {}, withErrorClass = true): void => {
      const error = truncateTraceError(extra.error);
      recordRoutingStep(body, {
        kind: "attempt",
        model: modelStr,
        index: i + 1,
        total: rotatedModels.length,
        outcome,
        durationMs: Date.now() - startedAt,
        startOffsetMs: startedAt - loopStartedAt,
        ...(extra.status !== undefined ? { status: extra.status } : {}),
        ...(error ? { error } : {}),
        ...(outcome === "cooldown_skip"
          ? { errorClass: "cooldown" as const }
          : outcome !== "ok" && withErrorClass ? { errorClass: classifyAttemptError(extra.status, extra.error) } : {}),
      });
    };
    const record = (outcome: AttemptOutcome, extra: { status?: number; error?: string } = {}): void => {
      traceStep(outcome, extra);
      // Only what says something about the model: not a cooldown skip, not a refused request.
      const errorClass = outcome === "ok" || outcome === "cooldown_skip" ? undefined : classifyAttemptError(extra.status, extra.error);
      if (outcome === "ok") recordAttemptDatum({ modelKey: modelStr, outcome: "ok", ttftMs: Date.now() - startedAt });
      else if (outcome !== "cooldown_skip" && errorClass !== "client") {
        recordAttemptDatum({ modelKey: modelStr, outcome: errorClass === "timeout" ? "timeout" : "fail" });
      }
      digest.push({ model: modelStr, label: outcome === "ok" ? "ok" : outcome === "cooldown_skip" ? "cooldown" : String(extra.status ?? outcome) });
    };
    // Lost the race: it says nothing about the model, so no stats, no penalty, no cooldown.
    const lose = (response?: Response): null => {
      discardResponse(response);
      traceStep("aborted", { error: "another model answered first" }, false);
      log.info?.("COMBO", `Model ${modelStr} lost the hedge`);
      return null;
    };
    const lost = (): boolean => signal?.aborted === true;
    const win = (): boolean => !race || claimRace(race, i);

    setFirstByteBudget(attemptBody, firstByteBudgetFor(i, race !== undefined));
    try {
      const result = await handleSingleModel(attemptBody, modelStr);
      setFirstByteBudget(attemptBody, undefined);
      if (lost()) return lose(result);
      if (result.ok) {
        if (!win()) return lose(result);
        if (isFreeFallback(result)) {
          // This model ran out of accounts and the free default answered in its place:
          // the request is served, but nothing here says the model is healthy.
          record("failed");
          recordModelFailure(modelStr);
          log.warn?.("COMBO", `Model ${modelStr} had no account left, answered by the free fallback`);
          return result;
        }
        if (race) selectModel(modelStr);
        record("ok", { status: result.status });
        recordModelSuccess(modelStr);
        if (adaptive && (i > 0 || modelStr === stickyModel)) rememberStickyModel(sessionKey, comboName || "", modelStr);
        log.info?.("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      const { errorText, retryAfter } = await extractResponseError(result);
      if (lost()) return lose();
      const { shouldFallback } = checkFallbackError(result.status, errorText);
      // The hedged model refusing the request says nothing about the primary, which may still answer.
      const hedgeRefused = race !== undefined && i !== race.primary && !shouldFallback;
      if (!shouldFallback && !hedgeRefused && !win()) return lose();

      earliestRetryAfter = trackEarliestRetryAfter(earliestRetryAfter, retryAfter);
      // A retryAfter in the body means no account was even tried: every one is cooling down.
      record(retryAfter ? "cooldown_skip" : "failed", { status: result.status, error: errorText });
      // Cooling-down models were already penalized when they failed; a request
      // the model rightly refused says nothing about its health.
      if (!retryAfter && classifyAttemptError(result.status, errorText) !== "client") recordModelFailure(modelStr, result.status);

      if (hedgeRefused) {
        lastError = errorText || String(result.status);
        if (!lastStatus) lastStatus = result.status;
        log.warn?.("COMBO", `Hedged model ${modelStr} refused the request, primary keeps running`, { status: result.status });
        return null;
      }
      if (!shouldFallback) {
        log.warn?.("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn?.("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
      return null;
    } catch (error: unknown) {
      if (lost()) return lose();
      const errMsg = error instanceof Error ? error.message : String(error);
      lastError = errMsg;
      if (!lastStatus) lastStatus = 500;
      // A throw skips the per-account step, which would leave a silent gap
      // between one attempt and the next in the trace.
      record("aborted", { error: errMsg });
      recordModelFailure(modelStr);
      log.warn?.("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
      return null;
    }
  };

  /**
   * Attempt `i`; if it stays silent past the hedge delay, also start `i + 1`.
   * The first to send a byte wins and aborts the other. At most two run at once.
   */
  const runHedged = async (i: number): Promise<{ response: Response | null; advance: number }> => {
    const modelStr = rotatedModels[i];
    const race: HedgeRace = { primary: i, winner: null, controllers: new Map([[i, new AbortController()]]) };
    const primary = runAttempt(i, race);

    const delayMs = comboHedgeDelayMs ?? hedgeDelayMs(modelStats.get(modelStr), isReasoningModel(modelStr));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const due = new Promise<typeof HEDGE_DUE>((resolve) => { timer = setTimeout(() => resolve(HEDGE_DUE), delayMs); });
    const first = await Promise.race([primary, due]);
    clearTimeout(timer);
    if (first !== HEDGE_DUE) return { response: first, advance: 1 };

    if (Date.now() - loopStartedAt >= timeBudgetMs) return { response: await primary, advance: 1 };
    log.info?.("COMBO", `Model ${modelStr} silent for ${delayMs}ms, also trying ${rotatedModels[i + 1]}`);
    race.controllers.set(i + 1, new AbortController());
    const hedged = runAttempt(i + 1, race);
    return { response: await firstResponse([primary, hedged]), advance: 2 };
  };

  for (let i = 0; i < rotatedModels.length;) {
    // The first attempt is always made; after that the loop stops starting new
    // ones once the budget is spent, so N slow models cannot add up to N timeouts.
    if (i > 0 && Date.now() - loopStartedAt >= timeBudgetMs) {
      log.warn?.("COMBO", `time budget (${timeBudgetMs}ms) spent after ${i} attempts, not trying the remaining ${rotatedModels.length - i}`);
      break;
    }
    const { response, advance } = canHedge && i < rotatedModels.length - 1
      ? await runHedged(i)
      : { response: await runAttempt(i), advance: 1 };
    if (response) return response;
    i += advance;
  }

  setFirstByteBudget(body, undefined);
  return buildAllFailedResponse(lastError, lastStatus, earliestRetryAfter, log, digest);
}

export { handleFusionChat } from "./comboFusion";
