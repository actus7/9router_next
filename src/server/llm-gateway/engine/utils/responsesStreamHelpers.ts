// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats";
import { formatSSE } from "./streamHelpers";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.done",
  "response.failed",
  "error"
]);

export function getOpenAIResponsesEventName(eventName: string | null, chunk: Record<string, unknown>) {
  if (eventName) return eventName;
  if (chunk && typeof chunk.type === "string") return chunk.type;
  return null;
}

export function isOpenAIResponsesTerminalEvent(eventName: string | null, chunk: Record<string, unknown>) {
  const type = getOpenAIResponsesEventName(eventName, chunk);
  if (OPENAI_RESPONSES_TERMINAL_EVENTS.has(type!)) return true;
  const response = chunk?.response as Record<string, unknown> | undefined;
  const status = response?.status;
  return status === "completed" || status === "failed";
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`);
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure() {
  return formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      response: {
        id: `resp_${Date.now()}`,
        status: "failed",
        error: {
          type: "stream_error",
          code: "stream_disconnected",
          message: "stream closed before response.completed"
        }
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
}

/**
 * What to send when the upstream dies mid-stream (stall timeout, reset), in
 * the client's own dialect. Closing the stream quietly made a truncated answer
 * look like a finished one: the OpenAI SDK only raises on a `data: {"error":…}`
 * line and the Anthropic SDK only on `event: error`.
 */
export function abortTerminalFor(sourceFormat: string): (() => Uint8Array) | null {
  const message = "upstream stream interrupted before completion";
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) return buildAbortedResponsesTerminalBytes;
  if (sourceFormat === FORMATS.OPENAI) {
    return () => sharedEncoder.encode(
      `data: ${JSON.stringify({ error: { message, type: "server_error", code: "stream_interrupted" } })}\n\ndata: [DONE]\n\n`,
    );
  }
  if (sourceFormat === FORMATS.CLAUDE) {
    return () => sharedEncoder.encode(
      `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`,
    );
  }
  return null;
}
