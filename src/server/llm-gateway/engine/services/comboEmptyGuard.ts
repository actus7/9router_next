// A 2xx is necessary but not sufficient for a combo member to have answered.
// Some upstreams reply HTTP 200 and then stream nothing usable — Gemini aborts a
// generation with MALFORMED_FUNCTION_CALL and still sends a terminal frame — so the
// combo logged "succeeded" and the empty answer reached the client with no fallback.
//
// The signal is structural, not a list of abort reasons: "the stream ended and no
// content frame was ever released". A refusal (content filter, safety) is the one
// kind of emptiness that would repeat on every member, so it is returned as is.
//
// It only says "empty" for a dialect it positively recognises. An event it cannot
// read counts as content: judging every member of a combo empty because the client
// speaks a dialect nobody listed would hand back only the last one.

type Json = Record<string, unknown>;

const asJson = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.length > 0;

/** Finish reasons that mean "refused", which every candidate would repeat. */
const NO_RETRY_FINISH: ReadonlySet<string> = new Set([
  "content_filter",
  "safety",
  "recitation",
  "blocklist",
  "prohibited_content",
  "refusal",
]);

export function isNoRetryFinish(finishReason: string | null | undefined): boolean {
  return finishReason ? NO_RETRY_FINISH.has(String(finishReason).toLowerCase()) : false;
}

interface LineInfo {
  content: boolean;
  finishReason: string | null;
}

const NOTHING: LineInfo = { content: false, finishReason: null };

/**
 * What a model produced, as the client sees it. Reasoning counts: a stream that
 * is thinking is alive, and holding it back until the first answer token would
 * hide the thinking from the client for as long as it lasts.
 */
function deltaHasContent(delta: Json): boolean {
  if (nonEmpty(delta.content) || (Array.isArray(delta.content) && delta.content.length > 0)) return true;
  if (arr(delta.tool_calls).length > 0 || delta.function_call) return true;
  return nonEmpty(delta.reasoning_content) || nonEmpty(delta.reasoning);
}

function inspectChat(parsed: Json): LineInfo {
  let content = false;
  let finishReason: string | null = null;
  for (const choice of arr(parsed.choices)) {
    if (deltaHasContent(asJson(choice.delta ?? choice.message))) content = true;
    if (typeof choice.finish_reason === "string" && choice.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, finishReason };
}

function inspectClaude(parsed: Json): LineInfo {
  const delta = asJson(parsed.delta);
  switch (parsed.type) {
    case "content_block_delta":
      return { content: nonEmpty(delta.text) || nonEmpty(delta.partial_json) || nonEmpty(delta.thinking), finishReason: null };
    case "content_block_start": {
      const block = asJson(parsed.content_block);
      const content = block.type === "tool_use" || (block.type === "text" && nonEmpty(block.text)) || (block.type === "thinking" && nonEmpty(block.thinking));
      return { content, finishReason: null };
    }
    case "message_delta":
      // The translator renders content_filter as a refusal for Claude clients.
      return { content: false, finishReason: delta.stop_reason ? (delta.stop_reason === "refusal" ? "content_filter" : "stop") : null };
    default:
      return NOTHING;
  }
}

const RESPONSES_CONTENT_DELTAS: ReadonlySet<string> = new Set([
  "response.output_text.delta",
  "response.refusal.delta",
  "response.function_call_arguments.delta",
  "response.custom_tool_call_input.delta",
  "response.reasoning_summary_text.delta",
  "response.reasoning_text.delta",
]);

function inspectResponses(parsed: Json): LineInfo {
  const type = String(parsed.type);
  if (RESPONSES_CONTENT_DELTAS.has(type)) return { content: nonEmpty(parsed.delta), finishReason: null };
  if (type === "response.output_text.done") return { content: nonEmpty(parsed.text), finishReason: null };
  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const itemType = asJson(parsed.item).type;
    return { content: itemType === "function_call" || itemType === "custom_tool_call", finishReason: null };
  }
  if (type === "response.completed") return { content: false, finishReason: "stop" };
  if (type === "response.failed") return { content: false, finishReason: "failed" };
  if (type === "response.incomplete") {
    const reason = asJson(asJson(parsed.response).incomplete_details).reason;
    return { content: false, finishReason: reason === "content_filter" ? "content_filter" : reason === "max_output_tokens" ? "length" : "incomplete" };
  }
  return NOTHING;
}

/** One complete SSE line, in the client's dialect: does it carry content and/or a finish reason? */
export function inspectSSELine(line: string): LineInfo {
  const text = line.trim();
  if (!text.startsWith("data:")) return NOTHING;
  const data = text.slice(5).trim();
  if (!data || data === "[DONE]") return NOTHING;
  let parsed: Json;
  try {
    parsed = asJson(JSON.parse(data));
  } catch {
    return NOTHING;
  }
  if (Array.isArray(parsed.choices)) return inspectChat(parsed);
  if (typeof parsed.type === "string") return parsed.type.startsWith("response.") ? inspectResponses(parsed) : inspectClaude(parsed);
  // A dialect not listed above (Gemini candidates, anything new): never call it empty.
  return { content: true, finishReason: null };
}

/**
 * A finished (non-streamed) 2xx answer with nothing usable in it. An empty message
 * that ended in a normal finish is the model's answer, not a failure.
 */
export function isZeroContentResponse(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const body = data as Json;

  if (Array.isArray(body.choices)) {
    const choice = arr(body.choices)[0];
    if (!choice) return true;
    const message = asJson(choice.message ?? choice.delta);
    const content = message.content;
    const hasContent = typeof content === "string" ? content.trim().length > 0 : Array.isArray(content) && content.length > 0;
    const hasToolCalls = arr(message.tool_calls).length > 0 || Boolean(message.function_call);
    const hasReasoning = typeof message.reasoning_content === "string" && message.reasoning_content.trim().length > 0;
    const finish = choice.finish_reason;
    const normalFinish = finish === "stop" || finish === "length" || finish === "tool_calls" || finish === "function_call";
    if (!hasContent && !hasToolCalls && !hasReasoning && !normalFinish) return true;
  }

  if (Array.isArray(body.content)) {
    const blocks = arr(body.content);
    const hasContent = blocks.some((c) => (c.type === "text" && nonEmpty(c.text) && String(c.text).trim().length > 0) || c.type === "tool_use");
    const stop = body.stop_reason;
    if (!hasContent && (!stop || stop === "in_progress" || stop === "incomplete")) return true;
  }

  return false;
}

export interface PeekedStream {
  /** `content`: serve it. `empty`: it ended with nothing usable. */
  outcome: "content" | "empty";
  finishReason: string | null;
  /** The same stream, replayed from its first byte. */
  response: Response;
}

/**
 * Hold an event stream until it shows its first content frame, ends, or `deadlineMs`
 * passes. A deadline is fail-open: a slow stream is never held, it is served.
 *
 * Returns null for a response that is not an event stream (nothing to peek).
 * Never loses a byte: the head that was read is replayed ahead of the live reader,
 * and a read still in flight when the deadline fires is handed on, not dropped.
 */
export async function peekForContent(response: Response, deadlineMs: number): Promise<PeekedStream | null> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!response.body || !contentType.includes("text/event-stream")) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const head: Uint8Array[] = [];
  let sawContent = false;
  let finishReason: string | null = null;
  let carry = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  const scan = (text: string): void => {
    const lines = text.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      const info = inspectSSELine(line);
      if (info.content) sawContent = true;
      if (info.finishReason) finishReason = info.finishReason;
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => { timer = setTimeout(() => resolve("deadline"), deadlineMs); });

  let outcome: "content" | "empty" = "empty";
  try {
    for (;;) {
      pending ??= reader.read();
      let step: ReadableStreamReadResult<Uint8Array> | "deadline";
      try {
        step = await Promise.race([pending, deadline]);
      } catch {
        // The upstream errored mid-peek; the replay surfaces the same error.
        pending = null;
        outcome = sawContent ? "content" : "empty";
        break;
      }
      if (step === "deadline") { outcome = "content"; break; }
      pending = null;
      if (step.done) {
        if (carry) scan(`${carry}\n`);
        outcome = sawContent ? "content" : "empty";
        break;
      }
      head.push(step.value);
      scan(carry + decoder.decode(step.value, { stream: true }));
      if (sawContent) { outcome = "content"; break; }
    }
  } finally {
    clearTimeout(timer);
  }

  return { outcome, finishReason, response: replay(response, head, reader, pending) };
}

export interface VerifiedContent {
  /** What to serve (or discard): same bytes as the original, even after a peek. */
  response: Response;
  empty: boolean;
  /** Why it is empty: the finish reason of a stream, or "no usable content". */
  reason: string;
}

/**
 * Whether a member's 2xx answer holds anything. A JSON body is read from a clone; an
 * event stream is peeked. A refusal (content filter, safety) is empty on purpose and
 * would repeat on every member, so it is reported as not empty and served.
 */
export async function verifyContent(result: Response, peekDeadlineMs: number): Promise<VerifiedContent> {
  const contentType = (result.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      if (isZeroContentResponse(await result.clone().json())) return { response: result, empty: true, reason: "no usable content" };
    } catch {
      // Not parseable JSON: leave it to the caller to serve as is.
    }
    return { response: result, empty: false, reason: "" };
  }

  const peeked = await peekForContent(result, peekDeadlineMs);
  if (!peeked) return { response: result, empty: false, reason: "" };
  const empty = peeked.outcome === "empty" && !isNoRetryFinish(peeked.finishReason);
  return { response: peeked.response, empty, reason: peeked.finishReason || "no-content" };
}

/** A Response that replays `head`, then the read still in flight, then the rest of `reader`. */
function replay(
  original: Response,
  head: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
  inFlight: Promise<ReadableStreamReadResult<Uint8Array>> | null,
): Response {
  // A read that fails after the peek is surfaced through the stream; this keeps it
  // from also being reported as unhandled if nobody ever reads the replay.
  inFlight?.catch(() => {});
  let pending = inFlight;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk);
    },
    async pull(controller) {
      const step = pending ? await pending : await reader.read();
      pending = null;
      if (step.done) controller.close();
      else controller.enqueue(step.value);
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(body, { status: original.status, statusText: original.statusText, headers: original.headers });
}
