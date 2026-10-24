import { describe, expect, it } from "vitest";
import { PONYTAIL_PROMPTS } from "@/server/llm-gateway/engine/rtk/ponytailPrompt";

describe("ponytail v5 prompts", () => {
  it.each(["lite", "full", "ultra"])("level %s carries the v5 rules", (level) => {
    const prompt = PONYTAIL_PROMPTS[level];
    expect(prompt).toContain("smallest complete change");
    expect(prompt).toContain("shortcut: <the limit>, <when to upgrade>");
    expect(prompt).not.toContain("ponytail:");
  });

  it("levels differ only in their intensity line", () => {
    expect(new Set(Object.values(PONYTAIL_PROMPTS)).size).toBe(3);
  });
});
