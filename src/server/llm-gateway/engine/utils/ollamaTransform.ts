// Gateway (OpenAI-shaped) response → Ollama /api/chat response.
// Spec: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
type Json = Record<string, unknown>;

const CORS = { "Access-Control-Allow-Origin": "*" };
const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson", ...CORS };

/** Ollama's error envelope is a bare string, not OpenAI's `{ error: { message } }`. */
export function ollamaError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: CORS });
}

function errorMessage(body: unknown): string {
  const b = body as { error?: unknown; message?: unknown } | null;
  const inner = b?.error as { message?: unknown } | string | undefined;
  if (typeof inner === "string") return inner;
  if (typeof inner?.message === "string") return inner.message;
  if (typeof b?.message === "string") return b.message;
  return "Upstream error";
}

function parseArguments(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try { return JSON.parse(args || "{}"); } catch { return {}; }
}

function toOllamaToolCalls(calls: { function?: { name?: unknown; arguments?: unknown } }[]) {
  return calls.map((tc) => ({ function: { name: tc.function?.name ?? "", arguments: parseArguments(tc.function?.arguments) } }));
}

/** Ollama reports "stop" for tool calls too; only a token cap is distinct. */
function doneReason(finish: unknown): string {
  return finish === "length" ? "length" : "stop";
}

function chunk(model: string, message: Json): Json {
  return { model, created_at: new Date().toISOString(), message: { role: "assistant", ...message }, done: false };
}

function finalLine(model: string, startedAt: number, finish: unknown, usage: Json | undefined): Json {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: "assistant", content: "" },
    done: true,
    done_reason: doneReason(finish),
    total_duration: (Date.now() - startedAt) * 1_000_000,
    prompt_eval_count: Number(usage?.prompt_tokens ?? 0),
    eval_count: Number(usage?.completion_tokens ?? 0),
  };
}

function completionToOllama(json: Json, model: string, startedAt: number): Json {
  const choice = ((json.choices as Json[] | undefined) ?? [])[0] ?? {};
  const message = (choice.message ?? {}) as Json;
  const out: Json = { content: typeof message.content === "string" ? message.content : "" };
  const thinking = message.reasoning_content ?? message.reasoning;
  if (typeof thinking === "string" && thinking) out.thinking = thinking;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) out.tool_calls = toOllamaToolCalls(message.tool_calls);
  const final = finalLine(model, startedAt, choice.finish_reason, json.usage as Json | undefined);
  return { ...final, message: { role: "assistant", ...out } };
}

/**
 * OpenAI SSE → Ollama line objects. The final `done:true` is written once, at
 * `[DONE]` or at end of stream — not at `finish_reason`, because the usage
 * chunk that fills eval_count arrives after it.
 */
function sseToOllamaLines(model: string, startedAt: number): TransformStream<string, Json> {
  let buffer = "";
  let ended = false;
  let finish: unknown;
  let usage: Json | undefined;
  const toolCalls: { function: { name: string; arguments: string } }[] = [];

  const end = (controller: TransformStreamDefaultController<Json>) => {
    if (ended) return;
    ended = true;
    if (toolCalls.length > 0) controller.enqueue(chunk(model, { content: "", tool_calls: toOllamaToolCalls(toolCalls) }));
    controller.enqueue(finalLine(model, startedAt, finish, usage));
  };

  const handle = (data: string, controller: TransformStreamDefaultController<Json>) => {
    if (data === "[DONE]") return end(controller);
    let parsed: Json;
    try { parsed = JSON.parse(data); } catch { return; }
    if (parsed.error) {
      ended = true;
      controller.enqueue({ error: errorMessage(parsed) });
      return;
    }
    if (parsed.usage) usage = parsed.usage as Json;
    const choice = ((parsed.choices as Json[] | undefined) ?? [])[0];
    if (!choice) return;
    const delta = (choice.delta ?? {}) as Json;
    for (const tc of (delta.tool_calls as { index?: number; function?: { name?: string; arguments?: string } }[] | undefined) ?? []) {
      const slot = (toolCalls[tc.index ?? 0] ??= { function: { name: "", arguments: "" } });
      slot.function.name += tc.function?.name ?? "";
      slot.function.arguments += tc.function?.arguments ?? "";
    }
    const content = typeof delta.content === "string" ? delta.content : "";
    const thinking = delta.reasoning_content ?? delta.reasoning;
    if (content || (typeof thinking === "string" && thinking)) {
      controller.enqueue(chunk(model, typeof thinking === "string" && thinking ? { content, thinking } : { content }));
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };

  return new TransformStream<string, Json>({
    transform(text, controller) {
      if (ended) return;
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (ended) return;
        if (line.startsWith("data:")) handle(line.slice(5).trim(), controller);
      }
    },
    flush(controller) {
      if (!ended && buffer.startsWith("data:")) handle(buffer.slice(5).trim(), controller);
      end(controller);
    },
  });
}

/** Folds the line objects back into the single object a non-stream client expects. */
async function collect(lines: ReadableStream<Json>): Promise<Response> {
  let content = "";
  let thinking = "";
  let toolCalls: unknown;
  let final: Json = {};
  for await (const line of lines as unknown as AsyncIterable<Json>) {
    if (line.error) return ollamaError(502, String(line.error));
    const message = (line.message ?? {}) as Json;
    content += typeof message.content === "string" ? message.content : "";
    thinking += typeof message.thinking === "string" ? message.thinking : "";
    if (message.tool_calls) toolCalls = message.tool_calls;
    if (line.done) final = line;
  }
  const message: Json = { role: "assistant", content };
  if (thinking) message.thinking = thinking;
  if (toolCalls) message.tool_calls = toolCalls;
  return Response.json({ ...final, message }, { headers: CORS });
}

function toNdjson(lines: ReadableStream<Json>): ReadableStream<Uint8Array> {
  return lines
    .pipeThrough(new TransformStream<Json, string>({ transform: (line, c) => c.enqueue(JSON.stringify(line) + "\n") }))
    .pipeThrough(new TextEncoderStream());
}

/**
 * The output shape follows what the Ollama client asked for (`stream`), not
 * what the gateway happened to answer with: a provider that forces streaming
 * can hand back SSE to a `stream:false` request, and a bypass can answer JSON
 * to a streaming one.
 */
export async function transformToOllama(
  response: Response,
  model: string,
  { stream, startedAt = Date.now() }: { stream: boolean; startedAt?: number },
): Promise<Response> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return ollamaError(response.status, errorMessage(body));
  }
  const isSse = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!isSse || !response.body) {
    const json = await response.json().catch(() => null);
    if (!json || typeof json !== "object") return ollamaError(502, "Upstream returned an unreadable response");
    const out = completionToOllama(json as Json, model, startedAt);
    return stream
      ? new Response(JSON.stringify(out) + "\n", { headers: NDJSON_HEADERS })
      : Response.json(out, { headers: CORS });
  }
  const lines = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(sseToOllamaLines(model, startedAt));
  return stream ? new Response(toNdjson(lines), { headers: NDJSON_HEADERS }) : collect(lines);
}
