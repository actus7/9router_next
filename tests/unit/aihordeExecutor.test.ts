import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIHordeExecutor } from "@/server/llm-gateway/engine/executors/aihorde";
import { proxyAwareFetch } from "@/server/llm-gateway/engine/utils/proxyFetch";

vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({ proxyAwareFetch: vi.fn() }));

const fetchMock = vi.mocked(proxyAwareFetch);
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const sentBody = (call: number) => JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));
const run = (body: Record<string, unknown>, stream = false, apiKey = "real-key") =>
  new AIHordeExecutor().execute({
    model: "koboldcpp/daybreak-kunoichi-2dpo-7b",
    body: { messages: [{ role: "user", content: "Oi" }], ...body },
    stream,
    credentials: { apiKey },
  } as never);

beforeEach(() => fetchMock.mockReset());

describe("AIHordeExecutor", () => {
  it("treats an empty-content 200 from a broken volunteer worker as a failure, not a success", async () => {
    // Captured live from oai.aihorde.net (koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic, 3/3).
    fetchMock.mockResolvedValue(json(200, {
      choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content: "" } }],
      usage: { kudos: 3 },
    }));
    await expect(run({})).rejects.toThrow(/empty completion/i);
  });

  it("accepts a tool-call answer with empty content and streams the tool call", async () => {
    // Shape captured live on 2026-10-31: the proxy now does tool calling.
    fetchMock.mockResolvedValue(json(200, {
      id: "chatcmpl-1",
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\": \"Paris\"}" } }] } }],
      usage: { prompt_tokens: 220, completion_tokens: 58, total_tokens: 278 },
    }));
    const { response } = await run({ tools: [{ type: "function", function: { name: "get_weather" } }] }, true);
    const text = await response.text();
    expect(text).toContain("\"name\":\"get_weather\"");
    expect(text).toContain("\"index\":0");
    expect(text).toContain("\"finish_reason\":\"tool_calls\"");
    expect(text).toContain("\"prompt_tokens\":220");
  });

  it("forwards tools, tool_choice and the OpenAI parameters the proxy now supports", () => {
    const body = new AIHordeExecutor().transformRequest("m", {
      model: "m",
      messages: [{ role: "user", content: "Ping" }],
      max_completion_tokens: 1,
      temperature: 0.2, top_p: 0.9, seed: 7, presence_penalty: 0.1,
      stop: "END",
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_object" },
      logprobs: true,
      tools: [{ type: "function", function: { name: "f" } }],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(body).toEqual({
      model: "m",
      messages: [{ role: "user", content: "Ping" }],
      max_tokens: 16,
      temperature: 0.2, top_p: 0.9, seed: 7, presence_penalty: 0.1,
      stop: ["END"],
      response_format: { type: "json_object" },
      tools: [{ type: "function", function: { name: "f" } }],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
  });

  it("drops tool_choice when there are no tools (the proxy 400s on it)", () => {
    const body = new AIHordeExecutor().transformRequest("m", { messages: [], tools: [], tool_choice: "auto" });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("retries once at the workers' completion limit when max_tokens is above it", async () => {
    // Exact 400 captured live for max_tokens 8192.
    fetchMock
      .mockResolvedValueOnce(json(400, { error: { code: "no_worker_supports_limit", param: "max_tokens",
        message: "No worker eligible for this request currently declares a completion limit that high; the largest any online worker for the model declares now is 2048 tokens." } }))
      .mockResolvedValueOnce(json(200, { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Oi!" } }] }));
    const { response } = await run({ max_tokens: 32000 });
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: "Oi!" } }] });
    expect(sentBody(0).max_tokens).toBe(16384); // API-wide ceiling
    expect(sentBody(1).max_tokens).toBe(2048);
  });

  it("shrinks max_tokens to fit the context after the prompt", async () => {
    fetchMock
      .mockResolvedValueOnce(json(400, { error: { param: "max_tokens",
        message: "The prompt is estimated at 8 tokens and the request wants 16384 more, which does not fit a max_context_length of 16384." } }))
      .mockResolvedValueOnce(json(200, { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Oi!" } }] }));
    await run({ max_tokens: 16384 });
    expect(sentBody(1).max_tokens).toBe(16376);
  });

  it("surfaces a 400 unrelated to the token limit without retrying", async () => {
    fetchMock.mockResolvedValue(json(400, { error: { message: "'tool_choice' is only allowed when 'tools' are specified." } }));
    await expect(run({})).rejects.toThrow(/AI Horde API error 400: 'tool_choice'/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps max_tokens at 512 for the anonymous key (higher answers 503 no_eligible_worker)", () => {
    const executor = new AIHordeExecutor();
    expect(executor.transformRequest("m", { messages: [], max_tokens: 4096 }, false, { apiKey: "public" }).max_tokens).toBe(512);
    expect(executor.transformRequest("m", { messages: [], max_tokens: 4096 }, false, { apiKey: "real-key" }).max_tokens).toBe(4096);
  });

  it("keeps the real usage the proxy reports", async () => {
    fetchMock.mockResolvedValue(json(200, {
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Oi!" } }],
      usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
    }));
    const { response } = await run({});
    expect((await response.json()).usage).toEqual({ prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 });
  });
});
