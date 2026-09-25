import { describe, expect, it, vi } from "vitest";

// O cliente paga e mede contexto pelo `usage` que devolvemos. Somar 2000
// tokens de "buffer" ao prompt tornava o número de todo request falso — o
// painel mostrava o real e o cliente outro.
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));

const { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } =
  await import("@/server/llm-gateway/engine/utils/stream");

async function pipe(transform: TransformStream<Uint8Array, Uint8Array>, upstream: string) {
  const out = new Response(new Response(upstream).body!.pipeThrough(transform));
  return out.text();
}

const jsonLines = (sse: string) =>
  sse.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));

describe("usage devolvido ao cliente", () => {
  it("passthrough OpenAI: usage do upstream sai intacto e [DONE] sai uma vez", async () => {
    const text = await pipe(createPassthroughStreamWithLogger("openai"), [
      `data: {"id":"c1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n`,
      `data: {"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n`,
      `data: [DONE]\n\n`,
    ].join(""));
    const usages = jsonLines(text).map((c) => c.usage).filter(Boolean);
    expect(usages.at(-1)).toMatchObject({ prompt_tokens: 10, total_tokens: 12 });
    expect(usages.some((u) => u.prompt_tokens >= 2000)).toBe(false);
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("Claude → cliente OpenAI: prompt_tokens é o do upstream, sem buffer", async () => {
    const text = await pipe(createSSETransformStreamWithLogger("claude", "openai", "anthropic"), [
      `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`,
      `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n`,
      `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ].join(""));
    const usage = jsonLines(text).map((c) => c.usage).filter(Boolean).at(-1);
    expect(usage.prompt_tokens).toBe(10);
  });
});
