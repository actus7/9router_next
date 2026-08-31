// HuggingChat (huggingface.co/chat) JSONL stream translation — ported from
// OmniRoute's huggingchat/jsonlStream.ts. HuggingChat streams NDJSON (one JSON
// object per line), never SSE; the previous version of this executor never
// even reached this endpoint (see huggingchat.ts for the endpoint/flow fix).

export function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

interface ParsedJsonlLine {
  token?: string;
  done?: boolean;
  error?: string;
  text?: string;
}

export function parseJsonlLine(line: string): ParsedJsonlLine {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;

    if (event.type === "stream" && typeof event.token === "string") {
      // Tokens arrive padded with NUL bytes to a fixed width.
      const token = event.token.replace(/\0/g, "");
      if (token) return { token };
    }

    if (event.type === "finalAnswer" && typeof event.text === "string") {
      return { text: event.text, done: true };
    }

    if (event.type === "status") {
      if (event.status === "error") {
        return { error: typeof event.message === "string" ? event.message : "HuggingChat generation error" };
      }
      if (event.status === "finished") {
        return { done: true };
      }
    }
  } catch {
    // Non-JSON lines (rare) are skipped.
  }

  return {};
}

export async function* streamJsonlToOpenAi(
  body: ReadableStream<Uint8Array>,
  model: string,
  id: string,
  created: number,
  signal?: AbortSignal | null
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedRole = false;
  let fullText = "";
  let finished = false;

  const roleChunk = () => sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  const contentChunk = (content: string) => sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  const stopChunk = () => sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseJsonlLine(trimmed);

        if (parsed.error) {
          yield stopChunk();
          yield "data: [DONE]\n\n";
          finished = true;
          return;
        }

        if (parsed.token) {
          if (!emittedRole) { emittedRole = true; yield roleChunk(); }
          fullText += parsed.token;
          yield contentChunk(parsed.token);
        }

        if (parsed.text) {
          const remaining = parsed.text.slice(fullText.length);
          if (remaining) {
            if (!emittedRole) { emittedRole = true; yield roleChunk(); }
            yield contentChunk(remaining);
          }
          finished = true;
          break;
        }

        if (parsed.done) { finished = true; break; }
      }

      if (finished) break;
    }

    if (!finished && buffer.trim() && !signal?.aborted) {
      const parsed = parseJsonlLine(buffer.trim());
      if (parsed.token) {
        if (!emittedRole) { emittedRole = true; yield roleChunk(); }
        yield contentChunk(parsed.token);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!signal?.aborted) {
    yield stopChunk();
    yield "data: [DONE]\n\n";
  }
}

export async function readJsonlResponse(body: ReadableStream<Uint8Array>, signal?: AbortSignal | null): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseJsonlLine(trimmed);
        if (parsed.token) fullText += parsed.token;
        if (parsed.text) return parsed.text;
        if (parsed.error) throw new Error(parsed.error);
      }
    }

    if (buffer.trim()) {
      const parsed = parseJsonlLine(buffer.trim());
      if (parsed.text) return parsed.text;
      if (parsed.token) fullText += parsed.token;
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}
