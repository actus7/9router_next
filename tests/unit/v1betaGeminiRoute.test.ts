import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleChat, buildModelsList } = vi.hoisted(() => ({
  handleChat: vi.fn(),
  buildModelsList: vi.fn(),
}));
vi.mock("@/server/application/http/gatewayRoute", () => ({ gatewayRoute: (h: unknown) => h }));
vi.mock("@/server/llm-gateway/chat", () => ({ handleChat }));
vi.mock("@/server/application/use-cases/http/v1/models/buildModelsList", () => ({ buildModelsList }));
// O caminho nativo (TTS) fala com o banco e com o Google; aqui só o traduzido importa.
vi.mock("@/server/application/use-cases/http/v1beta/models/geminiNativeForward", () => ({
  isGeminiNativeTtsRequest: () => false,
  forwardGeminiNativeRequest: vi.fn(),
}));

import { POST } from "@/app/api/v1beta/models/[...path]/route";
import { GET } from "@/app/api/v1beta/models/route";

type Json = Record<string, unknown>;

const post = (path: string[], body: Json) =>
  (POST as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request(`http://x/v1beta/models/${path.join("/")}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ path }) },
  );

async function sentBodyAsync(): Promise<Json> {
  return (handleChat.mock.calls[0][0] as Request).json();
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

async function readGeminiEvents(res: Response): Promise<Json[]> {
  const text = await res.text();
  return text.split(/\r?\n\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
}

const PNG_BASE64 = "iVBORw0KGgo" + "A".repeat(400_000);

const TOOL_TURN_BODY = {
  systemInstruction: { parts: [{ text: "be brief" }] },
  generationConfig: { stopSequences: ["END"], temperature: 0.2 },
  tools: [{ functionDeclarations: [{ name: "get_weather", description: "w", parameters: { type: "object", properties: { city: { type: "string" } } } }] }],
  contents: [
    { role: "user", parts: [{ text: "weather?" }, { inlineData: { mimeType: "image/png", data: PNG_BASE64 } }] },
    { role: "model", parts: [{ functionCall: { id: "call_1", name: "get_weather", args: { city: "Rio" } } }] },
    { role: "user", parts: [{ functionResponse: { id: "call_1", name: "get_weather", response: { result: "sunny" } } }] },
  ],
};

beforeEach(() => {
  handleChat.mockReset();
  buildModelsList.mockReset();
});

describe("POST /v1beta/models/{m}:generateContent", () => {
  it("forwards tools, function turns, images, system and stop sequences", async () => {
    handleChat.mockResolvedValue(Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    await post(["openai", "gpt-4o:generateContent"], TOOL_TURN_BODY);

    const body = await sentBodyAsync();
    expect(body.model).toBe("openai/gpt-4o");
    expect(body.stream).toBe(false);
    expect(body.stop).toEqual(["END"]);
    expect((body.tools as Json[])[0]).toMatchObject({ type: "function", function: { name: "get_weather" } });
    const messages = body.messages as Json[];
    expect(messages[0]).toEqual({ role: "system", content: "be brief" });
    const userParts = messages[1].content as Json[];
    expect(userParts.some((p) => p.type === "image_url" && String((p.image_url as Json).url).startsWith("data:image/png;base64,"))).toBe(true);
    expect(messages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1", function: { name: "get_weather" } }] });
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });

  it("answers a tool call as a Gemini functionCall part", async () => {
    handleChat.mockResolvedValue(Response.json({
      model: "gpt-4o",
      choices: [{
        message: { content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Rio\"}" } }] },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
    const res = await post(["openai", "gpt-4o:generateContent"], TOOL_TURN_BODY);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.candidates[0].content.parts).toEqual([{ functionCall: { id: "call_9", name: "get_weather", args: { city: "Rio" } } }]);
    expect(json.candidates[0].finishReason).toBe("STOP");
    expect(json.usageMetadata).toEqual({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
  });

  it("streams text and a tool call split across chunks as Gemini SSE", async () => {
    const line = (o: Json) => `data: ${JSON.stringify(o)}\n\n`;
    const toolStart = line({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_2", function: { name: "get_weather", arguments: "{\"ci" } }] } }] });
    handleChat.mockResolvedValue(sseResponse([
      line({ choices: [{ delta: { role: "assistant", content: "Hi" } }] }),
      // Um evento cortado no meio: o parser tem que juntar os pedaços.
      toolStart.slice(0, 20),
      toolStart.slice(20),
      line({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "ty\":\"Rio\"}" } }] } }] }),
      line({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      line({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
      "data: [DONE]\n\n",
    ]));
    const res = await post(["gpt-4o:streamGenerateContent"], TOOL_TURN_BODY);

    expect((await sentBodyAsync()).stream).toBe(true);
    const events = await readGeminiEvents(res);
    const parts = events.flatMap((e) => ((e.candidates as Json[])?.[0]?.content as Json)?.parts as Json[] ?? []);
    expect(parts).toContainEqual({ text: "Hi" });
    expect(parts).toContainEqual({ functionCall: { id: "call_2", name: "get_weather", args: { city: "Rio" } } });
    const last = events[events.length - 1];
    expect((last.candidates as Json[])[0].finishReason).toBe("STOP");
    expect(last.usageMetadata).toEqual({ promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 });
  });
});

describe("POST /v1beta/models/{m}:countTokens", () => {
  it("estimates without calling a provider and prices an image as a fixed block", async () => {
    const res = await post(["gpt-4o:countTokens"], TOOL_TURN_BODY);

    expect(res.status).toBe(200);
    const { totalTokens } = await res.json();
    expect(handleChat).not.toHaveBeenCalled();
    expect(totalTokens).toBeGreaterThan(0);
    // 400k chars de base64 contados como texto dariam ~100k tokens.
    expect(totalTokens).toBeLessThan(2000);
  });

  it("also counts a generateContentRequest envelope", async () => {
    const res = await post(["gpt-4o:countTokens"], { generateContentRequest: { contents: [{ role: "user", parts: [{ text: "a".repeat(400) }] }] } });
    expect((await res.json()).totalTokens).toBe(100);
  });
});

describe("GET /v1beta/models", () => {
  it("lists the account-aware /v1/models catalogue in Gemini shape", async () => {
    buildModelsList.mockResolvedValue([
      { id: "openai/gpt-4o", object: "model", owned_by: "openai", context_length: 128000, max_completion_tokens: 16384 },
      { id: "my-combo", object: "model", owned_by: "combo" },
    ]);
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request("http://x/v1beta/models"));

    expect(buildModelsList).toHaveBeenCalledWith(["llm"]);
    const { models } = await res.json();
    expect(models).toEqual([
      {
        name: "models/openai/gpt-4o",
        displayName: "openai/gpt-4o",
        supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"],
        inputTokenLimit: 128000,
        outputTokenLimit: 16384,
      },
      {
        name: "models/my-combo",
        displayName: "my-combo",
        supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"],
      },
    ]);
  });
});
