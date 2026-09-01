import { extractTextContent } from "../translator/formats/gemini";
import type { Logger } from "./types";
import { flattenToolHistory } from "./comboHistory";

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

/** Prepare the panel body: strip tools, flatten tool history, force non-streaming. */
function preparePanelBody(body: Record<string, unknown>): Record<string, unknown> {
  const { tools, tool_choice, stream_options, ...rest } = body as Record<string, unknown>;
  const panelBody: Record<string, unknown> = { ...rest, stream: false };
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages as Record<string, unknown>[]);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input as Record<string, unknown>[]);
  }
  return panelBody;
}

/** Extract successful answers from settled panel results. */
async function collectFusionAnswers(
  settled: (Response | { __timeout: true } | { __error: unknown } | undefined)[],
  panel: string[],
  log: Logger,
): Promise<{ model: string; text: string }[]> {
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
  return answers;
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
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info?.("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  const panelBody = preparePanelBody(body);

  const t0 = Date.now();
  const calls = panel.map((m: string) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info?.("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  const answers = await collectFusionAnswers(settled, panel, log);

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

  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info?.("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}

