import { trackToolCalls } from "./answerText";

/** The part of a stream's context that collects what the model said, for the request record. */
export interface ContentTracker {
  totalContentLength: number;
  accumulatedContent: string;
  accumulatedThinking: string;
  sawToolCall: boolean;
  toolCalls: string[];
}

function addContent(ctx: ContentTracker, text: unknown): void {
  if (typeof text !== "string" || !text) return;
  ctx.totalContentLength += text.length;
  ctx.accumulatedContent += text;
}

function addThinking(ctx: ContentTracker, text: unknown): void {
  if (typeof text !== "string" || !text) return;
  ctx.totalContentLength += text.length;
  ctx.accumulatedThinking += text;
}

const RESPONSES_REASONING_DELTAS = new Set(["response.reasoning_summary_text.delta", "response.reasoning_text.delta"]);

/** Track content/thinking from a parsed provider chunk, in every dialect the gateway reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parseSSELine / JSON.parse return any; callers pass through
export function trackContent(ctx: ContentTracker, parsed: any): void {
  trackToolCalls(ctx, parsed);
  // Responses API (Codex and friends): `delta` is the text itself. Without this
  // the client got the answer and the request record said it was empty.
  if (parsed.type === "response.output_text.delta") addContent(ctx, parsed.delta);
  if (RESPONSES_REASONING_DELTAS.has(parsed.type)) addThinking(ctx, parsed.delta);
  // Claude
  addContent(ctx, parsed.delta?.text);
  addThinking(ctx, parsed.delta?.thinking);
  // OpenAI Chat
  addContent(ctx, parsed.choices?.[0]?.delta?.content);
  addThinking(ctx, parsed.choices?.[0]?.delta?.reasoning_content);
  // Gemini
  for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
    if (part.thought === true) addThinking(ctx, part.text);
    else addContent(ctx, part.text);
  }
}
