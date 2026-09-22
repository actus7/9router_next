// The smart-routing classifier asks a cheap model to label one request's tier
// and need. It runs through the normal chat path, so the answer arrives in
// whichever envelope that provider speaks (chat completions, Anthropic content
// blocks, Responses output) and has to be dug out before parsing.

import type { JevRoutingClassification, LlmRoutingClassification } from "@/server/llm-gateway/engine/services/smart-routing/router";
import type { RouteNeed, RoutingTier } from "@/server/llm-gateway/engine/services/smart-routing/types";
import { evaluateJev, isJevFeatureEnabled, JEV_MODEL } from "@/server/decisions/jev";
import type { ClientRawRequest } from "@/server/llm-gateway/engine/handlers/chatCore/types";
import type { RequestBody } from "@/server/llm-gateway/engine/services/types";

export type SingleModelChatFn = (
  body: RequestBody,
  model: string,
  clientRawRequest: ClientRawRequest,
  request: Request,
  apiKey: string | null,
) => Promise<Response>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractClassifierText(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const choiceMessage = asRecord(firstChoice?.message);
  if (typeof choiceMessage?.content === "string") return choiceMessage.content;

  const content = Array.isArray(root.content) ? root.content : [];
  const firstContent = asRecord(content[0]);
  if (typeof firstContent?.text === "string") return firstContent.text;

  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const itemContent = Array.isArray(itemRecord?.content)
      ? itemRecord.content
      : [];
    const textPart = itemContent
      .map(asRecord)
      .find((part) => typeof part?.text === "string");
    if (typeof textPart?.text === "string") return textPart.text;
  }

  return typeof root.response === "string" ? root.response : "";
}

function parseRoutingClassification(
  payload: unknown,
): LlmRoutingClassification | null {
  const raw = extractClassifierText(payload);
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const value = asRecord(
      JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")),
    );
    if (
      !value ||
      typeof value.tier !== "string" ||
      !["simple", "standard", "complex", "reasoning"].includes(value.tier)
    ) {
      return null;
    }
    return { tier: value.tier, need: value.need } as LlmRoutingClassification;
  } catch {
    return null;
  }
}

// The classifier must never hold up the answer: past its budget the caller
// falls back to the deterministic score, so the race resolves to null instead
// of waiting for a slow provider.
export function buildClassifierCallback(
  request: Request,
  apiKey: string | null,
  runSingleModelChat: SingleModelChatFn,
) {
  return async (classifierModel: string, prompt: string, timeoutMs: number) => {
    const classifierBody: RequestBody = {
      model: classifierModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 120,
      stream: false,
    };
    const classifierRaw: ClientRawRequest = {
      endpoint: "/v1/chat/completions",
      body: classifierBody,
      headers: { accept: "application/json", "x-router-internal": "classifier" },
    };
    const responsePromise = runSingleModelChat(
      classifierBody,
      classifierModel,
      classifierRaw,
      request,
      apiKey,
    );
    const response = await Promise.race([
      responsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!response || !response.ok) return null;
    return parseRoutingClassification(await response.json());
  };
}

const JEV_TIER_CRITERIA: Record<RoutingTier, string> = {
  simple: "Lookup, greeting, rewording or a one-step answer any small model gets right",
  standard: "Ordinary multi-step work: explain, summarize, write or edit code of modest size",
  complex: "Large or multi-part work needing strong models: architecture, long code, deep analysis",
  reasoning: "Formal reasoning: proofs, math, logic puzzles, planning where each step must be verified",
};

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

// Jev answers the same two questions the LLM classifier is prompted for, but
// as typed choices: no JSON to dig out of a chat envelope, and a calibrated
// confidence the router can hold to its threshold.
export function buildJevClassifierCallback() {
  return async (text: string, endpointNeed: RouteNeed, timeoutMs: number): Promise<JevRoutingClassification | null> => {
    if (!(await isJevFeatureEnabled("smartRouting"))) return null;
    const answers = await evaluateJev(
      { request: text, endpointNeed },
      {
        tier: {
          type: "choice",
          instructions: "How capable a model does this request need? Judge the reasoning required, not the length of the answer. Prefer the cheapest tier that reliably completes it.",
          criteria: JEV_TIER_CRITERIA,
        },
        need: {
          type: "choice",
          instructions: `Which capability does this request need? The endpoint it arrived on implies "${endpointNeed}".`,
          criteria: JEV_NEED_CRITERIA,
        },
      },
      timeoutMs,
    );
    if (answers?.tier.type !== "choice" || answers.need.type !== "choice") return null;
    return {
      tier: answers.tier.choice as RoutingTier,
      need: answers.need.choice as RouteNeed,
      confidence: answers.tier.confidence,
      model: JEV_MODEL,
    };
  };
}

// Every smart-routed endpoint wires the same two classifiers.
export function smartRoutingClassifiers(
  request: Request,
  apiKey: string | null,
  runSingleModelChat: SingleModelChatFn,
) {
  return {
    classifyWithModel: buildClassifierCallback(request, apiKey, runSingleModelChat),
    classifyWithJev: buildJevClassifierCallback(),
  };
}
