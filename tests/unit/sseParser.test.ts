import { describe, it, expect } from "vitest";
import { sseChunk, chatChunkSse } from "@/server/llm-gateway/engine/utils/sse";
import { parseSSELine, formatSSE } from "@/server/llm-gateway/engine/utils/streamHelpers";

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Simulate the incremental TextDecoder pattern used in stream.ts */
function decodeChunks(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buf = "";
  for (const chunk of chunks) {
    buf += decoder.decode(chunk, { stream: true });
  }
  buf += decoder.decode(); // flush
  return buf;
}

/** Split a Uint8Array into `n` roughly-equal chunks */
function splitBytes(bytes: Uint8Array, n: number): Uint8Array[] {
  const size = Math.ceil(bytes.length / n);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, Math.min(i + size, bytes.length)));
  }
  return out;
}

// â”€â”€ (a) parsing a complete data: {...}\n\n frame â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("SSE frame building + parsing round-trip", () => {
  it("sseChunk produces parseable data line", () => {
    const payload = { id: "chatcmpl-1", choices: [{ delta: { content: "hi" } }] };
    const frame = sseChunk(payload);
    expect(frame).toMatch(/^data: /);
    expect(frame).toMatch(/\n\n$/);

    // parseSSELine expects a trimmed line without trailing \n\n
    const line = frame.trim();
    const parsed = parseSSELine(line);
    expect(parsed).toEqual(payload);
  });

  it("chatChunkSse produces parseable frame with correct shape", () => {
    const frame = chatChunkSse({
      id: "chatcmpl-abc",
      created: 1700000000,
      model: "gpt-4o",
      delta: { role: "assistant" },
    });
    const parsed = parseSSELine(frame.trim());
    expect(parsed).toMatchObject({
      id: "chatcmpl-abc",
      object: "chat.completion.chunk",
      model: "gpt-4o",
    });
    expect(parsed!.choices[0].delta).toEqual({ role: "assistant" });
    expect(parsed!.choices[0].finish_reason).toBeNull();
  });
});

// â”€â”€ (b) incremental feeding â€” one SSE event split across 2-3 chunks â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("incremental SSE feeding", () => {
  it("2-chunk split parses identically to single-shot", () => {
    const full = 'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"content":"hello world"}}]}\n\n';
    const bytes = new TextEncoder().encode(full);

    // Single-shot decode
    const singleShot = new TextDecoder().decode(bytes);
    const singleParsed = parseSSELine(singleShot.trim());

    // 2-chunk incremental decode
    const chunks = splitBytes(bytes, 2);
    const incremental = decodeChunks(chunks);
    const incrParsed = parseSSELine(incremental.trim());

    expect(incrParsed).toEqual(singleParsed);
  });

  it("3-chunk split parses identically to single-shot", () => {
    const full = 'data: {"choices":[{"delta":{"content":"streaming test"}}]}\n\n';
    const bytes = new TextEncoder().encode(full);

    const singleParsed = parseSSELine(new TextDecoder().decode(bytes).trim());

    const chunks = splitBytes(bytes, 3);
    const incremental = decodeChunks(chunks);
    const incrParsed = parseSSELine(incremental.trim());

    expect(incrParsed).toEqual(singleParsed);
  });
});

// â”€â”€ (c) UTF-8 multibyte chars split at arbitrary byte boundaries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("UTF-8 multibyte reassembly across chunks", () => {
  it("re-assembles 'Ã§Ã£o' (2-byte chars) split at odd boundary", () => {
    const text = 'data: {"text":"Ã§Ã£o"}\n\n';
    const bytes = new TextEncoder().encode(text);
    // Ã§ = 0xC3 0xA7 (2 bytes), Ã£ = 0xC3 0xA3 (2 bytes)
    // Feed in 3-byte chunks to split multi-byte chars
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 3) {
      chunks.push(bytes.slice(i, Math.min(i + 3, bytes.length)));
    }
    const decoded = decodeChunks(chunks);
    const parsed = parseSSELine(decoded.trim());
    expect(parsed).toEqual({ text: "Ã§Ã£o" });
  });

  it("re-assembles emoji 'ðŸš€' (4-byte char) split mid-codepoint", () => {
    const text = 'data: {"emoji":"ðŸš€"}\n\n';
    const bytes = new TextEncoder().encode(text);
    // ðŸš€ = F0 9F 9A 80 â€” feed in 2-byte chunks to split the 4-byte sequence
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      chunks.push(bytes.slice(i, Math.min(i + 2, bytes.length)));
    }
    const decoded = decodeChunks(chunks);
    const parsed = parseSSELine(decoded.trim());
    expect(parsed).toEqual({ emoji: "ðŸš€" });
  });

  it("re-assembles mixed ASCII + multibyte fed byte-by-byte", () => {
    const text = 'data: {"mix":"olÃ¡ mundo ðŸŒ"}\n\n';
    const bytes = new TextEncoder().encode(text);
    // Feed one byte at a time â€” worst case for split
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i++) {
      chunks.push(bytes.slice(i, i + 1));
    }
    const decoded = decodeChunks(chunks);
    const parsed = parseSSELine(decoded.trim());
    expect(parsed).toEqual({ mix: "olÃ¡ mundo ðŸŒ" });
  });
});

// â”€â”€ (d) data: [DONE] terminal handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("data: [DONE] terminal", () => {
  it("parseSSELine returns {done: true} for 'data: [DONE]'", () => {
    expect(parseSSELine("data: [DONE]")).toEqual({ done: true });
  });

  it("formatSSE emits 'data: [DONE]\\n\\n' for done sentinel", () => {
    expect(formatSSE({ done: true }, "openai")).toBe("data: [DONE]\n\n");
  });

  it("formatSSE emits 'data: null\\n\\n' for null", () => {
    expect(formatSSE(null, "openai")).toBe("data: null\n\n");
  });
});

// â”€â”€ (e) named events (event: foo\ndata: ...) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("named SSE events", () => {
  it("formatSSE with event+data produces named event frame", () => {
    const output = formatSSE(
      { event: "message_start", data: { type: "message_start", message: {} } },
      "openai"
    );
    expect(output).toMatch(/^event: message_start\ndata: /);
    expect(output).toMatch(/\n\n$/);
    const dataLine = output.split("\n").find((l) => l.startsWith("data:"));
    const parsed = JSON.parse(dataLine!.slice(5).trim());
    expect(parsed.type).toBe("message_start");
  });

  it("formatSSE with Claude type produces event frame", () => {
    const output = formatSSE(
      { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
      "claude"
    );
    expect(output).toMatch(/^event: content_block_delta\ndata: /);
  });

  it("sseChunk does NOT produce named events (data-only)", () => {
    const frame = sseChunk({ hello: "world" });
    expect(frame.startsWith("event:")).toBe(false);
    expect(frame.startsWith("data:")).toBe(true);
  });
});
