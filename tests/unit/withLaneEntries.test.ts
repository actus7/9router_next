import { describe, expect, it } from "vitest";
import { withLaneEntries } from "@/app/(dashboard)/dashboard/combos/[id]/smartComboHelpers";
import { DEFAULT_SMART_ROUTING_CONFIG } from "@/shared/llm-catalog";

describe("withLaneEntries", () => {
  const base = { ...DEFAULT_SMART_ROUTING_CONFIG, overrides: { general: { standard: ["a/m", "a/m"] } } };

  it("stores a lane's configs and keeps untouched lanes", () => {
    const set = withLaneEntries(base, "general", "standard", [{ connectionId: "x" }, null]);
    expect(set.entries?.general?.standard).toEqual([{ connectionId: "x" }, null]);
    const other = withLaneEntries(set, "general", "simple", [{ connectionId: "y" }]);
    expect(other.entries?.general?.standard).toBeDefined();
  });

  it("drops the key when nothing is configured, restoring the original shape", () => {
    const set = withLaneEntries(base, "general", "standard", [{ connectionId: "x" }]);
    expect(withLaneEntries(set, "general", "standard", [null, null])).toEqual(base);
    expect(withLaneEntries(set, "general", "standard", [])).not.toHaveProperty("entries");
  });
});

import { buildLaneEntries } from "@/app/(dashboard)/dashboard/combos/[id]/smartComboHelpers";
import type { SmartModelProfile } from "@/shared/llm-catalog";

describe("buildLaneEntries", () => {
  const p = (modelKey: string, extra: Partial<SmartModelProfile> = {}) => ({ modelKey, ...extra }) as SmartModelProfile;

  it("puts the lane's params on the entry and lists a multi-account model as primary + fallback", () => {
    const out = buildLaneEntries("reasoning", [
      p("codex/gpt-5.6-terra", { accountIds: ["a1", "a2", "a3"], laneParams: { reasoning: { reasoning_effort: "xhigh" } } }),
      p("zai/glm-5.3"),
    ]);
    expect(out.models).toEqual(["codex/gpt-5.6-terra", "codex/gpt-5.6-terra", "zai/glm-5.3"]);
    expect(out.entries).toEqual([
      { connectionId: "a1", params: { reasoning_effort: "xhigh" } },
      { connectionId: "a2", params: { reasoning_effort: "xhigh" } },
      null,
    ]);
  });

  it("does not exceed two copies of a model per lane", () => {
    const out = buildLaneEntries("simple", [p("a/m", { accountIds: ["1", "2"] }), p("a/m", { accountIds: ["1", "2"] })]);
    expect(out.models).toEqual(["a/m", "a/m"]);
  });
});
