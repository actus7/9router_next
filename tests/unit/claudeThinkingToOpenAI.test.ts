import { describe, expect, it, vi } from "vitest";

// Thinking travels only in `reasoning_content`. The translator also wrapped every
// thinking block in `content: "<think>"` ... `"</think>"`, so an OpenAI-format client
// rendered an empty "<think></think>" at the top of the answer as literal text.
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));

const { createSSETransformStreamWithLogger } = await import("@/server/llm-gateway/engine/utils/stream");

async function pipe(upstream: string): Promise<string> {
  const transform = createSSETransformStreamWithLogger("claude", "openai", "anthropic");
  return new Response(new Response(upstream).body!.pipeThrough(transform)).text();
}

type StreamChunk = { choices?: Array<{ delta?: Record<string, unknown> }> };

const jsonLines = (sse: string): StreamChunk[] =>
  sse.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));

const event = (name: string, data: Record<string, unknown>): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const CLAUDE_THINKING_THEN_TEXT = [
  event("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], usage: { input_tokens: 10, output_tokens: 0 } } }),
  event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
  event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } }),
  event("content_block_stop", { type: "content_block_stop", index: 0 }),
  event("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
  event("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The answer" } }),
  event("content_block_stop", { type: "content_block_stop", index: 1 }),
  event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
  event("message_stop", { type: "message_stop" }),
].join("");

describe("Claude → OpenAI stream with a thinking block", () => {
  it("sends the thinking as reasoning_content and puts no think markers in content", async () => {
    const chunks = jsonLines(await pipe(CLAUDE_THINKING_THEN_TEXT));
    const deltas: Array<Record<string, unknown>> = [];
    for (const chunk of chunks) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta) deltas.push(delta);
    }

    const content = deltas.map((d) => d.content).filter((c) => typeof c === "string").join("");
    const reasoning = deltas.map((d) => d.reasoning_content).filter((c) => typeof c === "string").join("");

    expect(reasoning).toBe("let me think");
    expect(content).toBe("The answer");
    expect(content).not.toMatch(/think>/);
  });
});
