import { describe, expect, it } from "vitest";

import cohere from "@/server/llm-gateway/engine/providers/registry/cohere";
import { DefaultExecutor } from "@/server/llm-gateway/engine/executors/default";

describe("Cohere OpenAI compatibility", () => {
  it("uses Cohere's OpenAI-compatible chat endpoint", () => {
    expect(cohere.transport.baseUrl).toBe("https://api.cohere.ai/compatibility/v1/chat/completions");
  });

  it("removes schema keywords Cohere rejects without removing the tool", () => {
    const executor = new DefaultExecutor("cohere");
    const body = executor.transformRequest("command-a-03-2025", {
      messages: [{ role: "user", content: [{ type: "text", text: "Ping" }] }],
      tools: [{
        type: "function",
        function: {
          name: "lookup",
          parameters: {
            type: "object",
            $schema: "https://json-schema.org/draft/2020-12/schema",
            additionalProperties: false,
            properties: {
              query: { type: "string", $schema: "https://json-schema.org/draft/2020-12/schema" },
            },
          },
        },
      }],
    }, true, { apiKey: "test" }) as Record<string, unknown>;

    expect(body.messages).toEqual([{ role: "user", content: "Ping" }]);
    expect(body.tools).toEqual([{
      type: "function",
      function: {
        name: "lookup",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    }]);
  });
});
