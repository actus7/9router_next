import { describe, expect, it } from "vitest";

import { isEmptyChatCompletion } from "@/server/llm-gateway/engine/handlers/chatCore/emptyCompletion";

describe("isEmptyChatCompletion", () => {
  it("is true for the exact shape AI Horde returned for a broken worker", () => {
    // Captured live from oai.aihorde.net for koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic,
    // reproduced 3/3 times: HTTP 200, finish_reason "stop", empty content.
    const response = {
      id: "d3097cdf-0ac0-4a54-bebe-c392bffc0987",
      choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content: "" } }],
      usage: { kudos: 3 },
      object: "chat.completion",
    };
    expect(isEmptyChatCompletion(response)).toBe(true);
  });

  it("is false when there is real text content", () => {
    const response = { choices: [{ message: { role: "assistant", content: "Oi!" } }] };
    expect(isEmptyChatCompletion(response)).toBe(false);
  });

  it("is false when the empty message carries tool calls", () => {
    const response = {
      choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "1", function: { name: "x", arguments: "{}" } }] } }],
    };
    expect(isEmptyChatCompletion(response)).toBe(false);
  });

  it("is false when the empty message carries reasoning_content (thinking-only turn)", () => {
    const response = {
      choices: [{ message: { role: "assistant", content: "", reasoning_content: "thinking it through..." } }],
    };
    expect(isEmptyChatCompletion(response)).toBe(false);
  });

  it("is false for a non-chat-completion body (no choices array)", () => {
    expect(isEmptyChatCompletion({ object: "response", output: [] })).toBe(false);
  });
});
