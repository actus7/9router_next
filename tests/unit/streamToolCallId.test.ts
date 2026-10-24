import { describe, expect, it, vi } from "vitest";

// OpenAI's streaming contract: the id and function.name arrive on the FIRST fragment of
// a tool call; later fragments carry only `index` + argument deltas. Some providers
// instead open a brand-new `index` in a late fragment and omit the id. Strict
// OpenAI-compatible clients (@ai-sdk/openai-compatible) then abort the whole turn with
// "Expected 'id' to be a string".
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));

const { ensureStreamToolCallIds } = await import("@/server/llm-gateway/engine/utils/streamHelpers");
const { createPassthroughStreamWithLogger } = await import("@/server/llm-gateway/engine/utils/stream");

type Chunk = { choices: Array<{ delta: { tool_calls?: Array<Record<string, unknown>> } }> };
const chunkWith = (...calls: Array<Record<string, unknown>>): Chunk => ({ choices: [{ delta: { tool_calls: calls } }] });
const callsOf = (chunk: Chunk): Array<Record<string, unknown>> => chunk.choices[0].delta.tool_calls ?? [];

describe("ensureStreamToolCallIds", () => {
  it("mints an id for a fragment that opens a new index without one", () => {
    const seen = new Map<unknown, string>();
    const chunk = chunkWith({ index: 1, function: { name: "read", arguments: "{}" } });

    expect(ensureStreamToolCallIds(chunk, seen)).toBe(true);

    expect(typeof callsOf(chunk)[0].id).toBe("string");
    expect(String(callsOf(chunk)[0].id).length).toBeGreaterThan(0);
    expect(seen.get(1)).toBe(callsOf(chunk)[0].id);
  });

  it("leaves an id the provider sent alone and remembers it", () => {
    const seen = new Map<unknown, string>();
    const chunk = chunkWith({ index: 0, id: "call_abc", function: { name: "f" } });

    expect(ensureStreamToolCallIds(chunk, seen)).toBe(false);

    expect(callsOf(chunk)[0].id).toBe("call_abc");
    expect(seen.get(0)).toBe("call_abc");
  });

  it("does not touch a continuation fragment of an index it already saw", () => {
    const seen = new Map<unknown, string>([[0, "call_abc"]]);
    const chunk = chunkWith({ index: 0, function: { arguments: "{\"a\":1}" } });

    expect(ensureStreamToolCallIds(chunk, seen)).toBe(false);

    expect(callsOf(chunk)[0]).not.toHaveProperty("id");
  });

  it("gives two different new indexes two different ids", () => {
    const seen = new Map<unknown, string>();
    const a = chunkWith({ index: 0, function: { name: "a" } });
    const b = chunkWith({ index: 1, function: { name: "b" } });

    ensureStreamToolCallIds(a, seen);
    ensureStreamToolCallIds(b, seen);

    expect(callsOf(a)[0].id).not.toBe(callsOf(b)[0].id);
  });

  it("leaves a fragment with neither id nor index alone: it cannot be told apart from a continuation", () => {
    const chunk = chunkWith({ function: { arguments: "x" } });
    expect(ensureStreamToolCallIds(chunk, new Map())).toBe(false);
    expect(callsOf(chunk)[0]).not.toHaveProperty("id");
  });

  it("ignores chunks without tool calls", () => {
    expect(ensureStreamToolCallIds({ choices: [{ delta: { content: "hi" } }] } as never, new Map())).toBe(false);
    expect(ensureStreamToolCallIds({ choices: [] } as never, new Map())).toBe(false);
    expect(ensureStreamToolCallIds({} as never, new Map())).toBe(false);
  });
});

async function pipe(upstream: string): Promise<string> {
  const transform = createPassthroughStreamWithLogger("openai");
  return new Response(new Response(upstream).body!.pipeThrough(transform)).text();
}

type StreamChunk = { choices?: Array<{ delta?: { tool_calls?: Array<Record<string, unknown>> } }> };

const jsonLines = (sse: string): StreamChunk[] =>
  sse.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));

describe("OpenAI passthrough stream", () => {
  it("gives a late tool call without an id one, and keeps it stable across its fragments", async () => {
    const frame = (call: Record<string, unknown>): string =>
      `data: ${JSON.stringify({ id: "chatcmpl-12345678", choices: [{ index: 0, delta: { tool_calls: [call] } }] })}\n\n`;

    const text = await pipe([
      frame({ index: 0, id: "call_one", type: "function", function: { name: "read", arguments: "" } }),
      frame({ index: 0, function: { arguments: "{\"p\":1}" } }),
      frame({ index: 1, type: "function", function: { name: "write", arguments: "" } }),
      frame({ index: 1, function: { arguments: "{\"q\":2}" } }),
      "data: [DONE]\n\n",
    ].join(""));

    const calls = jsonLines(text).flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []);
    expect(calls[0].id).toBe("call_one");
    expect(calls[1]).not.toHaveProperty("id");
    expect(typeof calls[2].id).toBe("string");
    expect(calls[3]).not.toHaveProperty("id");
    expect(calls[2].id).not.toBe("call_one");
  });
});
