import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCalls: string[] = [];

vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({
  proxyAwareFetch: vi.fn(async (url: string) => {
    fetchCalls.push(url);
    if (url.startsWith("https://api.quillbot.com/api/ai-chat/chat/conversation/")) {
      return new Response(
        '{"type":"status","status":"processing"}\n' +
          '{"content":"Hi","type":"content"}\n' +
          '{"content":" there","type":"content"}\n' +
          '{"type":"status","status":"completed"}\n',
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
      );
    }
    // Every path under quillbot.com sits behind a Cloudflare managed challenge:
    // any non-browser client gets the "Just a moment..." interstitial.
    return new Response("<!DOCTYPE html><html><title>Just a moment...</title>", {
      status: 403,
      headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" },
    });
  }),
}));

const { QuillbotExecutor } = await import("@/server/llm-gateway/engine/executors/quillbot");

describe("QuillbotExecutor", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
  });

  it("only talks to api.quillbot.com, never the Cloudflare-challenged www host", async () => {
    const executor = new QuillbotExecutor();

    const { response } = await executor.execute({
      model: "quillbot-ai",
      body: { messages: [{ role: "user", content: "Say hi" }] },
      stream: false,
      credentials: {},
    } as never);

    expect(response.status).toBe(200);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatch(
      /^https:\/\/api\.quillbot\.com\/api\/ai-chat\/chat\/conversation\/[0-9a-f-]{36}$/,
    );

    const payload = await response.json();
    expect(payload.choices[0].message.content).toBe("Hi there");
  });

  it("streams parsed NDJSON content back as SSE deltas", async () => {
    const executor = new QuillbotExecutor();

    const { response } = await executor.execute({
      model: "quillbot-ai",
      body: { messages: [{ role: "user", content: "Say hi" }] },
      stream: true,
      credentials: {},
    } as never);

    const text = await response.text();
    expect(text).toContain('"content":"Hi"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("data: [DONE]");
  });
});
