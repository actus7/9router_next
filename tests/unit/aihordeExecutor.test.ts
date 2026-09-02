import { describe, expect, it } from "vitest";

import { AIHordeExecutor } from "@/server/llm-gateway/engine/executors/aihorde";

describe("AIHordeExecutor", () => {
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
