import { describe, expect, it } from "vitest";
import { laneParamHints } from "@/server/llm-gateway/engine/services/smart-routing/laneParamHints";

describe("laneParamHints", () => {
  it("scales reasoning effort with the lane, within what the model accepts", () => {
    const by = (tier: "simple" | "standard" | "complex" | "reasoning") => laneParamHints("glm-5.3", tier)?.reasoning_effort;
    expect([by("simple"), by("standard"), by("complex"), by("reasoning")]).toEqual(["low", "high", "high", "max"]);
  });

  it("uses the model's own path and never picks 'none' for a lane", () => {
    expect(laneParamHints("gpt-5.6-terra", "simple")).toEqual({ reasoning_effort: "low" });
    expect(laneParamHints("gpt-5.6-terra", "reasoning")).toEqual({ reasoning_effort: "xhigh" });
  });

  it("accepts an effort whose condition the model's own default already meets", () => {
    expect(laneParamHints("deepseek-v4-flash", "reasoning")).toEqual({ reasoning_effort: "max" });
  });

  it("suggests nothing for a model the catalog does not know or one with no effort knob", () => {
    expect(laneParamHints("space-bunny-free", "reasoning")).toBeUndefined();
    expect(laneParamHints("mimo-v2.5-pro", "reasoning")).toBeUndefined();
  });
});
