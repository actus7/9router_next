/* eslint-disable @typescript-eslint/no-explicit-any -- asserting on loosely-shaped JSON */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/llm-gateway/engine/handlers/chatCore/requestDetail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveUsageStats: vi.fn(),
  buildRequestDetail: vi.fn(() => ({})),
}));
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({ saveRequestDetail: vi.fn(async () => undefined) }));

import { handleNonStreamingResponse } from "@/server/llm-gateway/engine/handlers/chatCore/nonStreamingHandler";

// A non-streaming reply translated to OpenAI must speak OpenAI's vocabulary:
// finish_reason is stop|length|tool_calls|content_filter, a Responses status is
// completed|incomplete, and cached prompt tokens are counted like the streaming path.
async function run(body: unknown, targetFormat: string, sourceFormat = "openai") {
  const ctx = {
    providerResponse: new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    provider: "p", model: "m", sourceFormat, targetFormat, body: {}, stream: false,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: () => {}, logConvertedResponse: () => {} },
    toolNameMap: new Map(), customToolNames: null,
    trackDone: () => {}, appendLog: () => {},
  };
  const result = await handleNonStreamingResponse(ctx as never);
  return (await (result as { response: Response }).response.json()) as Record<string, any>;
}

const gemini = (finishReason: string) => ({
  candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason }],
});
const claude = (stop_reason: string, usage: Record<string, number> = { input_tokens: 1, output_tokens: 1 }) => ({
  id: "msg_1", type: "message", content: [{ type: "text", text: "hi" }], stop_reason, usage,
});

describe("non-streaming OpenAI shape", () => {
  it("maps Gemini MAX_TOKENS to length and SAFETY to content_filter", async () => {
    expect((await run(gemini("MAX_TOKENS"), "gemini")).choices[0].finish_reason).toBe("length");
    expect((await run(gemini("SAFETY"), "gemini")).choices[0].finish_reason).toBe("content_filter");
  });

  it("maps Claude max_tokens to length", async () => {
    expect((await run(claude("max_tokens"), "claude")).choices[0].finish_reason).toBe("length");
  });

  it("counts Claude cache tokens in prompt_tokens and cached_tokens", async () => {
    const usage = (await run(claude("end_turn", {
      input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20,
    }), "claude")).usage;
    expect(usage.prompt_tokens).toBe(130);
    expect(usage.total_tokens).toBe(135);
    expect(usage.prompt_tokens_details.cached_tokens).toBe(100);
  });

  it("reports a truncated Responses reply as incomplete", async () => {
    const chat = (finish_reason: string) => ({
      id: "chatcmpl-1", choices: [{ message: { role: "assistant", content: "hi" }, finish_reason }],
    });
    const cut = await run(chat("length"), "openai", "openai-responses");
    expect(cut.status).toBe("incomplete");
    expect(cut.incomplete_details).toEqual({ reason: "max_output_tokens" });
    const filtered = await run(chat("content_filter"), "openai", "openai-responses");
    expect(filtered.incomplete_details).toEqual({ reason: "content_filter" });
    expect((await run(chat("stop"), "openai", "openai-responses")).status).toBe("completed");
  });
});
