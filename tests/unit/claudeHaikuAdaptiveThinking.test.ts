import { describe, expect, it } from "vitest";

import { normalizeClaudePassthrough } from "@/server/llm-gateway/engine/translator/formats/claude";

// Haiku 5.x accepts only adaptive thinking; Haiku 3.x/4.x reject it. The downgrade must
// follow the major version, not the word "haiku" (#5183).

function adaptiveBody() {
  return {
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    messages: [],
  };
}

describe("normalizeClaudePassthrough keeps adaptive thinking on Haiku 5+", () => {
  it.each([
    "claude-haiku-5-5",
    "claude-haiku-5.5",
    "claude-5.5-haiku",
    "claude-haiku-6",
    "anthropic/claude-haiku-5-5-20260101",
  ])("keeps adaptive thinking and effort for %s", (model) => {
    const body = normalizeClaudePassthrough(adaptiveBody(), model);

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });
});

describe("normalizeClaudePassthrough still downgrades Haiku below 5", () => {
  it.each([
    "claude-haiku-4-5",
    "claude-haiku-4.5",
    "claude-4.5-haiku",
    "claude-3-5-haiku-20241022",
    "claude-haiku",
    // A date is not a version: 20251001 must not read as "Haiku >= 5".
    "claude-haiku-20251001",
  ])("downgrades adaptive thinking for %s", (model) => {
    const body = normalizeClaudePassthrough(adaptiveBody(), model);

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
    expect(body.output_config).toBeUndefined();
  });

  it("leaves non-Haiku models untouched", () => {
    const body = normalizeClaudePassthrough(adaptiveBody(), "claude-sonnet-5");

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });
});
