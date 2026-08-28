/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback";
import { unavailableResponse } from "../utils/error";
import { getCapabilitiesForModel } from "../providers/capabilities";
import { extractTextContent } from "../translator/formats/gemini";
import type { Logger, ComboEntry, CombosData, RequestBody } from "./types";
import { getRoutingDecision } from "./smart-routing/context";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  return messages
    .filter((msg: Record<string, unknown>) => msg)
    .map((msg: Record<string, unknown>) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content as string | Record<string, unknown>[]) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = (tool_calls as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c?.function as Record<string, unknown>)?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content as string | Record<string, unknown>[]) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = (msg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => c.type === "tool_use");
        const hasToolResult = (msg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts: string[] = [];
          const toolNames: string[] = [];
          const toolResults: string[] = [];
          for (const block of msg.content as Record<string, unknown>[]) {
            if (block.type === "text" && block.text) textParts.push(block.text as string);
            if (block.type === "tool_use") toolNames.push((block.name as string) || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content as string | Record<string, unknown>[]) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models: string[], required: Set<string> | null | undefined): string[] {
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
export function getRotatedModels(models: string[], comboName: string, strategy: string, stickyLimit: number | string = 1): string[] {
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

/**
 * Handle combo chat with fallback
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true }: HandleComboChatOptions): Promise<Response> {
  // Apply rotation strategy if enabled
  let rotatedModels = getRotatedModels(models, comboName || "", comboStrategy || "fallback", comboStickyLimit);

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
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
      
      // Success (2xx) - return response
      if (result.ok) {
        log.info?.("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      // Extract error info from response
      let errorText: string = result.statusText || "";
      let retryAfter: string | null = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn?.("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info?.("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn?.("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error: unknown) {
      // Catch unexpected exceptions to ensure fallback continues
      const errMsg = error instanceof Error ? error.message : String(error);
      lastError = errMsg;
      if (!lastStatus) lastStatus = 500;
      log.warn?.("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
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
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json: Record<string, unknown>): string {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choices = json.choices as Record<string, unknown>[] | undefined;
  const choice = choices?.[0];
  if (choice) {
    const msg = (choice.message ?? choice.delta ?? {}) as Record<string, unknown>;
    const t = extractTextContent(msg.content as string | Record<string, unknown>[]);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content as string | Record<string, unknown>[]);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const candidates = json.candidates as Record<string, unknown>[] | undefined;
  const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p: Record<string, unknown>) => (p?.text as string) || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = (json.output as Record<string, unknown>[])
      .flatMap((o: Record<string, unknown>) => (Array.isArray(o.content) ? (o.content as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c?.text as string) || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body: Record<string, unknown>, text: string): Record<string, unknown> {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers: { model: string; text: string }[]): string {
  const panel = answers
    .map((a: { model: string; text: string }, i: number) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

interface FusionTuning {
  minPanel?: number;
  stragglerGraceMs?: number;
  panelHardTimeoutMs?: number;
}

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise: Promise<Response>, ms: number): Promise<Response | { __timeout: true } | { __error: unknown }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v: Response) => { clearTimeout(t); resolve(v); })
      .catch((e: unknown) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls: Promise<Response | { __timeout: true } | { __error: unknown }>[], { minPanel, stragglerGraceMs, panelHardTimeoutMs }: { minPanel: number; stragglerGraceMs: number; panelHardTimeoutMs: number }): Promise<(Response | { __timeout: true } | { __error: unknown } | undefined)[]> {
  return new Promise((resolve) => {
    const out: (Response | { __timeout: true } | { __error: unknown } | undefined)[] = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p: Promise<Response | { __timeout: true } | { __error: unknown }>, i: number) => {
      Promise.resolve(p)
        .then((v: Response | { __timeout: true } | { __error: unknown }) => { out[i] = v; })
        .catch((e: unknown) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          const entry = out[i];
          if (entry && "ok" in entry && entry.ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

interface HandleFusionChatOptions {
  body: Record<string, unknown>;
  models: string[];
  handleSingleModel: (body: Record<string, unknown>, modelStr: string, forceNonStream?: boolean) => Promise<Response>;
  log: Logger;
  comboName?: string;
  judgeModel?: string;
  tuning?: FusionTuning;
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }: HandleFusionChatOptions): Promise<Response> {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info?.("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped (we want prose).
  const { tools, tool_choice, stream_options, ...rest } = body as Record<string, unknown>;
  // Fusion runs panel models non-streaming; drop stream_options too, or providers
  // like DeepSeek reject it with "stream_options should be set along with stream = true".
  // See issue #3024.
  const panelBody: Record<string, unknown> = { ...rest, stream: false };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages as Record<string, unknown>[]);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input as Record<string, unknown>[]);
  }

  const t0 = Date.now();
  const calls = panel.map((m: string) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info?.("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const answers: { model: string; text: string }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn?.("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if ("__timeout" in res) { log.warn?.("FUSION", `Panel ${model} timed out`); continue; }
    if ("__error" in res) { log.warn?.("FUSION", `Panel ${model} threw`, { error: res.__error instanceof Error ? res.__error.message : String(res.__error) }); continue; }
    if (!res.ok) { log.warn?.("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info?.("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn?.("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e: unknown) {
      log.warn?.("FUSION", `Panel ${model} unparseable`, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn?.("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info?.("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info?.("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
