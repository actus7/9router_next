// The smart-routing classifier asks a cheap model to label one request's tier
// and need. It runs through the normal chat path, so the answer arrives in
// whichever envelope that provider speaks (chat completions, Anthropic content
// blocks, Responses output) and has to be dug out before parsing.

import type { LlmRoutingClassification } from "@/server/llm-gateway/engine/services/smart-routing/router";
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

export function extractClassifierText(payload: unknown): string {
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

export function parseRoutingClassification(
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
