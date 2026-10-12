import { describe, expect, it, vi } from "vitest";
import {
  decideLaneVerdicts,
  parseLlmAnswers,
  type LaneAsker,
} from "@/server/application/use-cases/smart-routing/laneVerdicts";
import type { RoutingTier, SmartModelProfile } from "@/shared/llm-catalog";

function board(count: number): SmartModelProfile[] {
  return Array.from({ length: count }, (_, i) => ({
    modelKey: `p/m${i}`,
    provider: "p",
    model: `m${i}`,
    displayName: `M${i}`,
    canonicalKey: `m${i}`,
    capabilities: { serviceKinds: ["llm"], reasoning: false, tools: true, vision: false, contextWindow: 1, maxOutput: 1 },
    laneScores: { standard: 0.5 },
  })) as unknown as SmartModelProfile[];
}

const allowedFor = (profiles: SmartModelProfile[], lanes: RoutingTier[] = ["standard", "complex"]) =>
  new Map(profiles.map((p) => [p.canonicalKey as string, lanes]));

const answer = (value: number): LaneAsker => async (batch) =>
  new Map(batch.map((c) => [c.canonicalKey, Object.fromEntries(c.lanes.map((lane) => [lane, value]))]));

describe("decideLaneVerdicts", () => {
  it("uses Jev for everything it answers and never calls the LLM", async () => {
    const profiles = board(5);
    const llm = vi.fn(answer(0.1));
    const { verdicts, counts } = await decideLaneVerdicts(profiles, allowedFor(profiles), { jev: answer(0.9), llm }, { batchSize: 2 });
    expect(llm).not.toHaveBeenCalled();
    expect(counts).toEqual({ jev: 5, llm: 0, rules: 0 });
    expect(verdicts.get("m0")?.source).toBe("jev");
  });

  it("hands a batch Jev could not answer to the LLM", async () => {
    const profiles = board(4);
    const { verdicts, counts } = await decideLaneVerdicts(profiles, allowedFor(profiles), { jev: async () => null, llm: answer(0.8) }, { batchSize: 2 });
    expect(counts).toEqual({ jev: 0, llm: 4, rules: 0 });
    expect(verdicts.get("m3")?.source).toBe("llm");
  });

  it("leaves the models to the mechanical rules when neither decider answers", async () => {
    const profiles = board(3);
    const { verdicts, counts } = await decideLaneVerdicts(profiles, allowedFor(profiles), { jev: async () => null, llm: async () => null });
    expect(verdicts.size).toBe(0);
    expect(counts).toEqual({ jev: 0, llm: 0, rules: 3 });
  });

  it("works without an LLM available", async () => {
    const profiles = board(2);
    const { counts } = await decideLaneVerdicts(profiles, allowedFor(profiles), { jev: async () => null, llm: null });
    expect(counts.rules).toBe(2);
  });

  it("stops asking a decider that already failed instead of repeating the timeout per batch", async () => {
    const profiles = board(6);
    const jev = vi.fn<LaneAsker>(async () => null);
    await decideLaneVerdicts(profiles, allowedFor(profiles), { jev, llm: answer(0.7) }, { batchSize: 2, concurrency: 1 });
    expect(jev).toHaveBeenCalledTimes(1);
  });

  it("asks only about the lanes each model is allowed in, once per canonical model", async () => {
    const profiles = [...board(2), { ...board(1)[0], modelKey: "q/m0", provider: "q" }] as SmartModelProfile[];
    const seen: Array<[string, RoutingTier[]]> = [];
    const jev: LaneAsker = async (batch) => {
      for (const c of batch) seen.push([c.canonicalKey, c.lanes]);
      return new Map(batch.map((c) => [c.canonicalKey, { [c.lanes[0]]: 0.9 }]));
    };
    await decideLaneVerdicts(profiles, new Map([["m0", ["complex"]], ["m1", ["simple", "standard"]]] as Array<[string, RoutingTier[]]>), { jev, llm: null });
    expect(seen.sort()).toEqual([["m0", ["complex"]], ["m1", ["simple", "standard"]]]);
  });
});

describe("parseLlmAnswers", () => {
  const batch = [
    { canonicalKey: "a", model: "a", displayName: "A", lanes: ["simple", "standard"], facts: {} },
    { canonicalKey: "b", model: "b", displayName: "B", lanes: ["complex"], facts: {} },
  ] as Parameters<typeof parseLlmAnswers>[1];

  it("reads a fenced JSON array and maps ids back to canonical keys", () => {
    const json = '[{"id":"m0","lanes":{"simple":0.2,"standard":0.8}},{"id":"m1","lanes":{"complex":0.9}}]';
    const fence = "```";
    const text = ["Here you go:", `${fence}json`, json, fence].join("\n");
    expect(parseLlmAnswers(text, batch)?.get("a")).toEqual({ simple: 0.2, standard: 0.8 });
    expect(parseLlmAnswers(text, batch)?.get("b")).toEqual({ complex: 0.9 });
  });

  it("ignores unknown ids and non-numeric scores, and returns null on garbage", () => {
    expect(parseLlmAnswers('[{"id":"m9","lanes":{"simple":1}},{"id":"m0","lanes":{"simple":"high"}}]', batch)?.get("a")).toEqual({});
    expect(parseLlmAnswers("no json here", batch)).toBeNull();
    expect(parseLlmAnswers("[not json]", batch)).toBeNull();
  });
});
