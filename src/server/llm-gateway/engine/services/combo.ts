/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback";
import { unavailableResponse } from "../utils/error";
import { getCapabilitiesForModel } from "../providers/capabilities";
import type { Logger, ComboEntry, CombosData } from "./types";
import { getRoutingDecision } from "./smart-routing/context";

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

/** Wait a short cooldown for transient 5xx errors before falling through. */
async function waitTransientCooldown(status: number, cooldownMs: number, modelStr: string, log: Logger): Promise<void> {
  if (cooldownMs > 0 && cooldownMs <= 5000 &&
      (status === 503 || status === 502 || status === 504)) {
    log.info?.("COMBO", `Model ${modelStr} transient ${status}, waiting ${cooldownMs}ms before next`);
    await new Promise(r => setTimeout(r, cooldownMs));
  }
}

/** Build the final "all models failed" response. */
function buildAllFailedResponse(lastError: string | null, lastStatus: number | null, earliestRetryAfter: string | null, log: Logger): Response {
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

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

/**
 * Handle combo chat with fallback
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true }: HandleComboChatOptions): Promise<Response> {
  let rotatedModels = getRotatedModels(models, comboName || "", comboStrategy || "fallback", comboStickyLimit);

  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info?.("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }

  let lastError: string | null = null;
  let earliestRetryAfter: string | null = null;
  let lastStatus: number | null = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    const routingDecision = getRoutingDecision(body);
    if (routingDecision) {
      const candidate = routingDecision.candidateDetails.find((item) => item.model === modelStr);
      routingDecision.selectedModel = modelStr;
      if (candidate) routingDecision.degraded = candidate.degraded;
    }
    log.info?.("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      if (result.ok) {
        log.info?.("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      const { errorText, retryAfter } = await extractResponseError(result);
      earliestRetryAfter = trackEarliestRetryAfter(earliestRetryAfter, retryAfter);

      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);
      if (!shouldFallback) {
        log.warn?.("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      await waitTransientCooldown(result.status, cooldownMs || 0, modelStr, log);

      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn?.("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      lastError = errMsg;
      if (!lastStatus) lastStatus = 500;
      log.warn?.("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  return buildAllFailedResponse(lastError, lastStatus, earliestRetryAfter, log);
}

export { handleFusionChat } from "./comboFusion";
