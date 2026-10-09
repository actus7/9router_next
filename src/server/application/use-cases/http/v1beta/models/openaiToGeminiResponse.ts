/**
 * OpenAI chat.completion (JSON and SSE) → Gemini GenerateContentResponse.
 *
 * The engine has no openai→gemini *response* translator — its Gemini response
 * code goes the other way (a Gemini upstream answering an OpenAI client) — and
 * a Gemini source format inside chatCore is forced to stream, which a
 * `:generateContent` client cannot read. So the v1beta route sends an OpenAI
 * body through `handleChat` like every other endpoint and reshapes the answer
 * here, at the boundary.
 */

type Json = Record<string, unknown>;

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

// tool_calls is still a normal end of turn for Gemini: the functionCall part is the signal.
const FINISH_REASON_MAP: Record<string, string> = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

function finishReasonOf(reason: unknown): string {
  return FINISH_REASON_MAP[String(reason)] || "STOP";
}

function parseArgs(raw: unknown): Json {
  if (raw && typeof raw === "object") return raw as Json;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    // A model that emitted broken JSON still called the tool; hand the text over.
    return { _raw: String(raw) };
  }
}

function functionCallPart(call: { id?: unknown; name?: unknown; arguments?: unknown }): Json {
  // The id rides back so the client's functionResponse pairs with this call
  // (gemini-to-openai reads `functionResponse.id` as the tool_call_id).
  const functionCall: Json = { name: call.name, args: parseArgs(call.arguments) };
  if (call.id) functionCall.id = call.id;
  return { functionCall };
}

function usageMetadataOf(usage: Json | undefined): Json | undefined {
  if (!usage) return undefined;
  const meta: Json = {
    promptTokenCount: usage.prompt_tokens || 0,
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0,
  };
  const reasoning = (usage.completion_tokens_details as Json | undefined)?.reasoning_tokens;
  if (reasoning) meta.thoughtsTokenCount = reasoning;
  return meta;
}

function candidate(parts: Json[], finishReason?: string): Json {
  const c: Json = { content: { role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] }, index: 0 };
  if (finishReason) c.finishReason = finishReason;
  return c;
}

export async function openaiJsonToGemini(response: Response, model: string): Promise<Response> {
  if (!response.ok) return response;
  let body: Json;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  if (body.candidates || body.error) return Response.json(body, { status: response.status, headers: JSON_HEADERS });

  const choice = (body.choices as Json[] | undefined)?.[0];
  if (!choice) return Response.json(body, { headers: JSON_HEADERS });

  const message = (choice.message || {}) as Json;
  const parts: Json[] = [];
  if (message.reasoning_content) parts.push({ text: message.reasoning_content, thought: true });
  if (message.content) parts.push({ text: message.content });
  for (const call of (message.tool_calls as Json[] | undefined) || []) {
    const fn = (call.function || {}) as Json;
    parts.push(functionCallPart({ id: call.id, name: fn.name, arguments: fn.arguments }));
  }

  const out: Json = { candidates: [candidate(parts, finishReasonOf(choice.finish_reason))], modelVersion: body.model || model };
  const usageMetadata = usageMetadataOf(body.usage as Json | undefined);
  if (usageMetadata) out.usageMetadata = usageMetadata;
  return Response.json(out, { headers: JSON_HEADERS });
}

interface PendingCall { id?: string; name?: string; arguments: string }

/**
 * OpenAI SSE → Gemini SSE. Gemini has no argument deltas, so tool calls are
 * accumulated by index and emitted whole with the final chunk; that chunk also
 * waits for the usage-only chunk `include_usage` sends after finish_reason.
 */
export function openaiSseToGemini(upstream: Response, model: string): Response {
  if (!upstream.ok || !upstream.body) return upstream;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const calls = new Map<number, PendingCall>();
  let buffer = "";
  let finishReason: string | null = null;
  let usage: Json | undefined;
  let modelVersion = model;
  let finalSent = false;

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, chunk: Json) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
  };

  const emitFinal = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (finalSent || (finishReason === null && calls.size === 0 && !usage)) return;
    finalSent = true;
    const parts = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => functionCallPart(call));
    const chunk: Json = { candidates: [candidate(parts, finishReason || "STOP")], modelVersion };
    const usageMetadata = usageMetadataOf(usage);
    if (usageMetadata) chunk.usageMetadata = usageMetadata;
    emit(controller, chunk);
  };

  const handleEvent = (data: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!data || data === "[DONE]") return;
    let parsed: Json;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed.model) modelVersion = String(parsed.model);
    if (parsed.usage) usage = parsed.usage as Json;

    const choice = (parsed.choices as Json[] | undefined)?.[0];
    const delta = (choice?.delta || {}) as Json;
    const parts: Json[] = [];
    if (delta.reasoning_content) parts.push({ text: delta.reasoning_content, thought: true });
    if (delta.content) parts.push({ text: delta.content });
    if (parts.length > 0) emit(controller, { candidates: [candidate(parts)], modelVersion });

    for (const tc of (delta.tool_calls as Json[] | undefined) || []) {
      const index = Number(tc.index ?? 0);
      const fn = (tc.function || {}) as Json;
      const pending = calls.get(index) || { arguments: "" };
      if (tc.id) pending.id = String(tc.id);
      if (fn.name) pending.name = String(fn.name);
      if (fn.arguments) pending.arguments += String(fn.arguments);
      calls.set(index, pending);
    }

    if (choice?.finish_reason) finishReason = finishReasonOf(choice.finish_reason);
    // Usage arrives either on the finish chunk or right after it.
    if (finishReason !== null && usage) emitFinal(controller);
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Events can be split across network chunks; only complete lines are parsed.
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) handleEvent(line.slice(5).trim(), controller);
      }
    },
    flush(controller) {
      if (buffer.startsWith("data:")) handleEvent(buffer.slice(5).trim(), controller);
      emitFinal(controller);
    },
  });

  return new Response(upstream.body.pipeThrough(transform), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Access-Control-Allow-Origin": "*" },
  });
}
