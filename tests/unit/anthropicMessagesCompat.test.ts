import { describe, it, expect, vi } from "vitest";

// Cliente Anthropic (@anthropic-ai/sdk, Claude Code) falando com /v1/messages:
// o SDK classifica erro pelo `error.type` do corpo Anthropic, não pelo status.

vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
}));
vi.mock("@/server/llm-gateway/engine/handlers/chatCore/requestDetail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveUsageStats: vi.fn(),
}));
vi.mock("@/server/application/http/gatewayRoute", () => ({
  gatewayRoute: (h: (r: Request) => Promise<Response>) => h,
}));

vi.mock("@/server/llm-gateway/translator", () => ({ initTranslators: async () => {} }));
vi.mock("@/server/llm-gateway/chat", async () => {
  const { errorResponse: err, toAnthropicErrorResponse: toA } = await import("@/server/llm-gateway/engine/utils/error");
  return { handleChat: async () => err(429, "slow down"), toAnthropicErrorResponse: toA };
});

import { POST as messagesPOST } from "@/app/api/v1/messages/route";
import { errorResponse, unavailableResponse, toAnthropicErrorResponse } from "@/server/llm-gateway/engine/utils/error";
import { fromOpenAIFinish } from "@/server/llm-gateway/engine/translator/concerns/finishReason";
import { adjustMaxTokens } from "@/server/llm-gateway/engine/translator/formats/maxTokens";
import { handleNonStreamingResponse } from "@/server/llm-gateway/engine/handlers/chatCore/nonStreamingHandler";
import { translateResponse, initState } from "@/server/llm-gateway/engine/translator/index";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
import { POST as countTokens } from "@/app/api/v1/messages/count_tokens/route";

describe("erros no formato Anthropic", () => {
  it.each([
    [400, "invalid_request_error"],
    [401, "authentication_error"],
    [403, "permission_error"],
    [404, "not_found_error"],
    [429, "rate_limit_error"],
    [500, "api_error"],
    [502, "api_error"],
    [503, "overloaded_error"],
    [529, "overloaded_error"],
  ])("status %i vira error.type %s, status preservado", async (status, type) => {
    const res = await toAnthropicErrorResponse(errorResponse(status, "boom"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ type: "error", error: { type, message: "boom" } });
  });

  it("preserva Retry-After do unavailableResponse", async () => {
    const res = await toAnthropicErrorResponse(unavailableResponse(429, "all limited", new Date(Date.now() + 30_000).toISOString(), "reset after 30s"));
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect((await res.json()).error.type).toBe("rate_limit_error");
  });

  it("POST /v1/messages devolve o erro já no envelope Anthropic", async () => {
    const res = await messagesPOST(new Request("http://x/v1/messages", { method: "POST", body: "{}" }) as never);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
  });

  it("não mexe em resposta de sucesso", async () => {
    const ok = new Response(JSON.stringify({ type: "message" }), { status: 200 });
    expect(await toAnthropicErrorResponse(ok)).toBe(ok);
  });

  it("unavailableResponse no formato OpenAI traz type e code", async () => {
    const body = await unavailableResponse(429, "x", new Date().toISOString(), "now").json();
    expect(body.error).toMatchObject({ type: "rate_limit_error", code: "rate_limit_exceeded" });
  });
});

describe("stop_reason para cliente Claude", () => {
  it("content_filter vira refusal", () => {
    expect(fromOpenAIFinish("content_filter", "claude")).toBe("refusal");
  });

  it("tool_use no content força stop_reason tool_use mesmo com finish_reason stop", async () => {
    const upstream = {
      id: "chatcmpl-abcdefgh", model: "m",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(upstream), { headers: { "content-type": "application/json" } }),
      provider: "openai", model: "m", sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI,
      body: {}, stream: false, translatedBody: {}, requestStartTime: Date.now(), connectionId: "c",
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} }, toolNameMap: new Map(),
      trackDone() {}, appendLog() {},
    } as unknown as Parameters<typeof handleNonStreamingResponse>[0]);
    expect((await result.response.json()).stop_reason).toBe("tool_use");
  });
});

describe("max_tokens do cliente", () => {
  it("com tools, max_tokens explícito é respeitado", () => {
    expect(adjustMaxTokens({ max_tokens: 100, tools: [{ name: "f" }] })).toBe(100);
  });
});

describe("message_start", () => {
  it("usa usage do primeiro chunk quando presente", () => {
    const state = initState(FORMATS.CLAUDE) as Record<string, unknown>;
    const out = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, {
      id: "chatcmpl-abcdefgh", model: "m",
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
      usage: { prompt_tokens: 42, completion_tokens: 0 },
    }, state) as Array<Record<string, unknown>>;
    const start = out.find((e) => e.type === "message_start") as { message: { usage: { input_tokens: number } } };
    expect(start.message.usage.input_tokens).toBe(42);
  });
});

describe("count_tokens", () => {
  const post = (body: string) => countTokens(new Request("http://x/v1/messages/count_tokens", { method: "POST", body }) as never);

  it("imagem base64 conta como estimativa fixa, não pelo tamanho", async () => {
    const data = "A".repeat(1_000_000);
    const res = await post(JSON.stringify({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }] }] }));
    const { input_tokens } = await res.json();
    expect(input_tokens).toBeLessThan(5000);
    expect(input_tokens).toBeGreaterThan(1000);
  });

  it("imagem dentro de tool_result também não conta o base64", async () => {
    const data = "A".repeat(1_000_000);
    const res = await post(JSON.stringify({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "base64", data } }] }] }] }));
    expect((await res.json()).input_tokens).toBeLessThan(5000);
  });

  it("JSON inválido devolve erro Anthropic 400", async () => {
    const res = await post("{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } });
  });
});
