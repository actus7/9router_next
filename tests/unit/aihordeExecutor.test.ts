import { describe, expect, it, vi } from "vitest";

import { AIHordeExecutor } from "@/server/llm-gateway/engine/executors/aihorde";

vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({
  // Captured live from oai.aihorde.net for
  // koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic, reproduced 3/3 times:
  // HTTP 200, finish_reason "stop", completely empty content — the volunteer
  // worker is broken, but the queued proxy still reports success.
  proxyAwareFetch: vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: "d3097cdf-0ac0-4a54-bebe-c392bffc0987",
        choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content: "" } }],
        usage: { kudos: 3 },
        object: "chat.completion",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  ),
}));

describe("AIHordeExecutor", () => {
  it("treats an empty-content 200 from a broken volunteer worker as a failure, not a success", async () => {
    const executor = new AIHordeExecutor();

    await expect(
      executor.execute({
        model: "koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic",
        body: { messages: [{ role: "user", content: "Oi" }] },
        stream: false,
        credentials: { apiKey: "public" },
      } as never),
    ).rejects.toThrow(/empty completion/i);
  });


  it("never forwards the client streaming flag to AI Horde's queued upstream", () => {
    const executor = new AIHordeExecutor();

    const body = executor.transformRequest(
      "koboldcpp/Llama-3.2-1B-Instruct",
      {
        model: "koboldcpp/Llama-3.2-1B-Instruct",
        messages: [{ role: "user", content: "Ping" }],
        max_tokens: 1,
        stream: true,
      },
      true,
      { apiKey: "public" },
    );

    expect(body.max_tokens).toBe(16);
    expect(body.stream).toBeUndefined();
  });

  it("forwards only AI Horde's supported OpenAI-compatible parameters", () => {
    const executor = new AIHordeExecutor();

    const body = executor.transformRequest(
      "koboldcpp/Llama-3.2-1B-Instruct",
      {
        model: "koboldcpp/Llama-3.2-1B-Instruct",
        messages: [{ role: "user", content: "Ping" }],
        temperature: 0.2,
        top_p: 0.9,
        stop: "END",
        stream: true,
        stream_options: { include_usage: true },
        response_format: { type: "json_object" },
        reasoning_effort: "high",
        logprobs: true,
        tools: [{ type: "function", function: { name: "unavailable" } }],
      },
      true,
      { apiKey: "public" },
    );

    expect(body).toEqual({
      model: "koboldcpp/Llama-3.2-1B-Instruct",
      messages: [{ role: "user", content: "Ping" }],
      max_tokens: 512,
      temperature: 0.2,
      top_p: 0.9,
      stop: ["END"],
    });
  });
});
