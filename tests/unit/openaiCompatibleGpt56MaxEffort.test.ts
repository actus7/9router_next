import { describe, expect, it } from "vitest";

import { getThinkingLevels } from "@/server/llm-gateway/engine/providers/thinkingLevels";
import { applyThinking } from "@/server/llm-gateway/engine/translator/concerns/thinkingUnified";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

// OpenAI documents effort "max" for GPT-5.6 / GPT-6. A node serving those ids must keep it;
// the openai format list has no "max", so it was clamped to xhigh on the wire (#5186).

const NODE = "openai-compatible-chat-test";
const MAX_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

describe("OpenAI Compatible node keeps effort max for GPT-5.6", () => {
  it.each(MAX_MODELS)("%s: max reaches the wire as max", (model) => {
    const out = applyThinking(FORMATS.OPENAI, model, { reasoning_effort: "max" }, NODE);

    expect(out.reasoning_effort).toBe("max");
  });

  it.each(MAX_MODELS)("%s: level picker offers max", (model) => {
    expect(getThinkingLevels(NODE, model)).toContain("max");
  });

  it("older GPT models on a node keep the xhigh clamp", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", { reasoning_effort: "max" }, NODE);

    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("built-in openai provider is unchanged", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", { reasoning_effort: "max" }, "openai");

    expect(out.reasoning_effort).toBe("xhigh");
  });
});
