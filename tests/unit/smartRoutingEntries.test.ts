import { describe, expect, it } from "vitest";
import {
  normalizeSmartRoutingConfig,
  validateSmartRoutingConfig,
} from "@/server/llm-gateway/engine/services/smart-routing/router";
import { expandEntryCandidates } from "@/server/llm-gateway/engine/services/smart-routing/entries";
import type { RankedSmartCandidate } from "@/server/llm-gateway/engine/services/smart-routing/inventory";

const lane = (overrides: unknown, entries?: unknown) => ({ overrides: { general: { standard: overrides } }, ...(entries ? { entries: { general: { standard: entries } } } : {}) });

describe("normalizeSmartRoutingConfig entries", () => {
  it("keeps the lane as model keys and the configs index-aligned", () => {
    const config = normalizeSmartRoutingConfig(lane(
      ["codex/gpt-5.6-terra", "codex/gpt-5.6-terra", "zai/glm-5.3"],
      [{ connectionId: "chat" }, { connectionId: "rob", params: { reasoning_effort: "high" } }, null],
    ));
    expect(config.overrides.general?.standard).toEqual(["codex/gpt-5.6-terra", "codex/gpt-5.6-terra", "zai/glm-5.3"]);
    expect(config.entries?.general?.standard).toEqual([
      { connectionId: "chat" },
      { connectionId: "rob", params: { reasoning_effort: "high" } },
      null,
    ]);
  });

  it("collapses an exact duplicate (same model, same account) and its config with it", () => {
    const config = normalizeSmartRoutingConfig(lane(
      ["a/m", "a/m", "b/m"],
      [{ connectionId: "x" }, { connectionId: "x" }, null],
    ));
    expect(config.overrides.general?.standard).toEqual(["a/m", "b/m"]);
    expect(config.entries?.general?.standard).toEqual([{ connectionId: "x" }, null]);
  });

  it("drops the entries of a lane where nothing is configured, so old configs keep their exact shape", () => {
    const config = normalizeSmartRoutingConfig(lane(["a/m", "b/m"], [null, null]));
    expect(config.entries).toBeUndefined();
  });

  it("ignores a malformed entry instead of failing the read", () => {
    const config = normalizeSmartRoutingConfig(lane(["a/m"], [{ connectionId: 5, params: { x: { nested: 1 } } }]));
    expect(config.entries).toBeUndefined();
  });

  it("is unchanged for a config with no entries at all", () => {
    expect(normalizeSmartRoutingConfig(lane(["a/m", "a/m"])).overrides.general?.standard).toEqual(["a/m"]);
  });
});

describe("validateSmartRoutingConfig entry params", () => {
  const withParams = (model: string, params: unknown) => lane([model], [{ params }]);

  it("accepts values the catalog allows for the model", () => {
    expect(validateSmartRoutingConfig(withParams("zai/glm-5.3", { temperature: 0.5 })).ok).toBe(true);
  });

  it("rejects an out-of-range value, naming the model and the parameter", () => {
    const result = validateSmartRoutingConfig(withParams("zai/glm-5.3", { temperature: 99 }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/glm-5\.3/);
    expect(!result.ok && result.error).toMatch(/temperature/);
  });

  it("rejects parameters for a model the catalog does not know", () => {
    const result = validateSmartRoutingConfig(withParams("opencode-go/space-bunny-free", { temperature: 0.5 }));
    expect(result.ok).toBe(false);
  });

  it("does not require parameters: an entry with only an account is fine for any model", () => {
    expect(validateSmartRoutingConfig(lane(["opencode-go/space-bunny-free"], [{ connectionId: "c1" }])).ok).toBe(true);
  });
});

describe("expandEntryCandidates", () => {
  const ranked = (...keys: string[]): RankedSmartCandidate[] =>
    keys.map((modelKey, i) => ({ modelKey, tier: "standard", degraded: false, source: "manual", score: 2 - i * 0.1, column: true as const }));

  it("turns one ranked model into one candidate per entry, in lane order, with each entry's config", () => {
    const config = normalizeSmartRoutingConfig(lane(
      ["codex/gpt-5.6-terra", "zai/glm-5.3", "codex/gpt-5.6-terra"],
      [{ connectionId: "chat" }, null, { connectionId: "rob" }],
    ));
    const out = expandEntryCandidates(ranked("codex/gpt-5.6-terra", "zai/glm-5.3"), config, "general");
    expect(out.candidates.map((c) => c.modelKey)).toEqual(["codex/gpt-5.6-terra", "codex/gpt-5.6-terra", "zai/glm-5.3"]);
    expect(out.entryConfigs.get("codex/gpt-5.6-terra")).toEqual([{ connectionId: "chat" }, { connectionId: "rob" }]);
    expect(out.entryConfigs.has("zai/glm-5.3")).toBe(false);
  });

  it("falls back to the general lane for a need without its own column, like the ranking does", () => {
    const config = normalizeSmartRoutingConfig(lane(["a/m"], [{ connectionId: "x" }]));
    const out = expandEntryCandidates(ranked("a/m"), config, "tool_use");
    expect(out.entryConfigs.get("a/m")).toEqual([{ connectionId: "x" }]);
  });

  it("leaves candidates alone when no entry is configured", () => {
    const config = normalizeSmartRoutingConfig(lane(["a/m", "b/m"]));
    const input = ranked("a/m", "b/m");
    const out = expandEntryCandidates(input, config, "general");
    expect(out.candidates).toEqual(input);
    expect(out.entryConfigs.size).toBe(0);
  });
});
