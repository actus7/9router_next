import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Clientes Ollama (Open WebUI, Continue, Enchanted, ollama-python) falando com
// /v1/api/chat e /api/tags. O contrato é o da doc da API do Ollama: NDJSON com
// exatamente uma linha `done:true` no stream, um objeto único sem stream, e
// erro como `{ error: "..." }` com o status HTTP preservado.

const handleChat = vi.fn<(req: Request) => Promise<Response>>();
const buildModelsList = vi.fn<(kinds: string[], opts?: unknown) => Promise<Record<string, unknown>[]>>();

vi.mock("@/server/application/http/gatewayRoute", () => ({
  gatewayRoute: (h: (r: Request) => Promise<Response>) => h,
}));
vi.mock("@/server/llm-gateway/translator", () => ({ initTranslators: async () => {} }));
vi.mock("@/server/llm-gateway/chat", async () => ({
  ...(await import("@/server/llm-gateway/engine/utils/ollamaTransform")),
  ...(await import("@/server/llm-gateway/engine/utils/ollamaRequest")),
  handleChat: (req: Request) => handleChat(req),
}));
vi.mock("@/server/application/use-cases/http/v1/models/buildModelsList", () => ({
  buildModelsList: (kinds: string[], opts?: unknown) => buildModelsList(kinds, opts),
}));

import { POST as chatPOST } from "@/app/api/v1/api/chat/route";
import { GET as tagsGET } from "@/app/api/tags/route";
import { GET as v1TagsGET } from "@/app/api/v1/api/tags/route";
import { errorResponse } from "@/server/llm-gateway/engine/utils/error";
import { ollamaChatToOpenAI } from "@/server/llm-gateway/engine/utils/ollamaRequest";

function chat(body: unknown): Promise<Response> {
  return chatPOST(new Request("http://x/v1/api/chat", { method: "POST", body: JSON.stringify(body) }) as never);
}

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
}

async function ndjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  expect(text.endsWith("\n")).toBe(true);
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

async function forwardedBody(): Promise<Record<string, unknown>> {
  return handleChat.mock.calls[0][0].json();
}

const completion = {
  choices: [{
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Porto Alegre\"}" } }],
    },
    finish_reason: "tool_calls",
  }],
  usage: { prompt_tokens: 12, completion_tokens: 5 },
};

beforeEach(() => {
  handleChat.mockReset();
  buildModelsList.mockReset();
});

describe("POST /v1/api/chat sem stream", () => {
  it("devolve um único objeto Ollama com tool_calls de argumentos em objeto", async () => {
    handleChat.mockResolvedValue(Response.json(completion));
    const res = await chat({ model: "gpt", messages: [{ role: "user", content: "oi" }], stream: false });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({
      model: "gpt",
      message: { role: "assistant", content: "", tool_calls: [{ function: { name: "get_weather", arguments: { city: "Porto Alegre" } } }] },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 12,
      eval_count: 5,
    });
    expect(typeof body.created_at).toBe("string");
    expect(typeof body.total_duration).toBe("number");
    expect((await forwardedBody()).stream).toBe(false);
  });

  it("agrega num objeto só quando o upstream respondeu SSE mesmo assim", async () => {
    handleChat.mockResolvedValue(sse([
      { choices: [{ delta: { content: "Olá" } }] },
      { choices: [{ delta: { content: " mundo" }, finish_reason: "length" }] },
      "[DONE]",
    ]));
    const res = await chat({ model: "gpt", messages: [], stream: false });
    expect(await res.json()).toMatchObject({ message: { role: "assistant", content: "Olá mundo" }, done: true, done_reason: "length" });
  });
});

describe("POST /v1/api/chat com stream", () => {
  it("stream omitido é stream (padrão do Ollama), e sai uma única linha done:true", async () => {
    handleChat.mockResolvedValue(sse([
      { choices: [{ delta: { role: "assistant", content: "Olá" } }] },
      { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
      "[DONE]",
    ]));
    const res = await chat({ model: "gpt", messages: [{ role: "user", content: "oi" }] });

    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await forwardedBody()).stream).toBe(true);
    const lines = await ndjson(res);
    expect(lines.map((l) => l.done)).toEqual([false, false, true]);
    expect(lines.map((l) => (l.message as { content: string }).content)).toEqual(["Olá", "!", ""]);
    expect(lines[2]).toMatchObject({ done_reason: "stop", prompt_eval_count: 3, eval_count: 2 });
  });

  it("acumula tool_calls fragmentadas e as entrega antes do done", async () => {
    handleChat.mockResolvedValue(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_weather", arguments: "{\"ci" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "ty\":\"Lisboa\"}" } }] }, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]));
    const lines = await ndjson(await chat({ model: "gpt", messages: [], stream: true }));
    expect(lines.filter((l) => l.done)).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      done: false,
      message: { tool_calls: [{ function: { name: "get_weather", arguments: { city: "Lisboa" } } }] },
    });
  });

  it("stream que termina sem [DONE] ainda fecha com um done:true", async () => {
    handleChat.mockResolvedValue(sse([{ choices: [{ delta: { content: "a" } }] }]));
    const lines = await ndjson(await chat({ model: "gpt", messages: [] }));
    expect(lines.map((l) => l.done)).toEqual([false, true]);
  });

  it("erro no meio do stream vira uma linha { error } e nenhum done", async () => {
    handleChat.mockResolvedValue(sse([{ error: { message: "upstream caiu" } }]));
    const lines = await ndjson(await chat({ model: "gpt", messages: [] }));
    expect(lines).toEqual([{ error: "upstream caiu" }]);
  });
});

describe("POST /v1/api/chat com erro", () => {
  it.each([400, 401, 429, 502])("status %i preservado, corpo { error } do Ollama", async (status) => {
    handleChat.mockResolvedValue(errorResponse(status, "deu ruim"));
    const res = await chat({ model: "gpt", messages: [], stream: true });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: "deu ruim" });
  });

  it("JSON inválido é 400 sem chamar o gateway", async () => {
    const res = await chatPOST(new Request("http://x/v1/api/chat", { method: "POST", body: "{" }) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(handleChat).not.toHaveBeenCalled();
  });
});

describe("pedido Ollama → OpenAI", () => {
  it("traduz options, format, images, tools e o histórico de tool calls", () => {
    const tools = [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }];
    const out = ollamaChatToOpenAI({
      model: "gpt",
      keep_alive: "5m",
      options: { temperature: 0.2, top_p: 0.9, num_predict: 64, stop: ["\n"], seed: 7 },
      format: "json",
      tools,
      messages: [
        { role: "user", content: "veja", images: ["iVBORw0KGgo="] },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "get_weather", arguments: { city: "Lisboa" } } }] },
        { role: "tool", tool_name: "get_weather", content: "18C" },
      ],
    });

    expect(out).toMatchObject({
      model: "gpt",
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 64,
      stop: ["\n"],
      seed: 7,
      response_format: { type: "json_object" },
      tools,
    });
    expect(out).not.toHaveProperty("options");
    expect(out).not.toHaveProperty("keep_alive");
    const [user, assistant, tool] = out.messages as Record<string, unknown>[];
    expect(user.content).toEqual([
      { type: "text", text: "veja" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ]);
    const call = (assistant.tool_calls as Record<string, { arguments: string }>[])[0];
    expect(call.function.arguments).toBe("{\"city\":\"Lisboa\"}");
    expect(tool.tool_call_id).toBe(call.id);
  });

  it("format com schema vira json_schema", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(ollamaChatToOpenAI({ model: "m", messages: [], format: schema }).response_format)
      .toEqual({ type: "json_schema", json_schema: { name: "response", schema } });
  });
});

describe("GET /api/tags e /v1/api/tags", () => {
  it.each([["/api/tags", tagsGET], ["/v1/api/tags", v1TagsGET]])("%s lista os modelos reais da conta", async (path, GET) => {
    buildModelsList.mockResolvedValue([{ id: "openai/gpt-4o", object: "model", owned_by: "openai" }]);
    const res = await GET(new Request(`http://x${path}`) as never);
    expect(res.status).toBe(200);
    expect(buildModelsList).toHaveBeenCalledWith(["llm"], expect.anything());
    expect(await res.json()).toEqual({
      models: [{
        name: "openai/gpt-4o",
        model: "openai/gpt-4o",
        modified_at: expect.any(String),
        size: 0,
        digest: "",
        details: { format: "", family: "", parameter_size: "", quantization_level: "" },
      }],
    });
  });

  it("falha na listagem vira 500 { error }", async () => {
    buildModelsList.mockRejectedValue(new Error("neon fora"));
    const res = await v1TagsGET(new Request("http://x/v1/api/tags") as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "neon fora" });
  });

  it("autentica por API key, não por sessão do dashboard", () => {
    for (const file of ["src/app/api/tags/route.ts", "src/app/api/v1/api/tags/route.ts"]) {
      const source = readFileSync(resolve(__dirname, "../..", file), "utf8");
      expect(source, file).toContain("gatewayRoute(");
      expect(source, file).not.toContain("tenantRoute(");
    }
  });
});
