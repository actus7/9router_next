import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";

let profiles: SmartModelProfile[] = [];
vi.mock("@/server/llm-gateway/engine/services/smart-routing/inventory", async (importActual) => ({
  ...(await importActual<typeof import("@/server/llm-gateway/engine/services/smart-routing/inventory")>()),
  refreshDeterministicSmartProfiles: vi.fn(async () => profiles),
}));
vi.mock("@/server/llm-gateway/engine/host/store", () => ({ getComboByName: vi.fn(async () => null) }));

import { resolveSmartRouting } from "@/server/llm-gateway/engine/services/smart-routing/router";
import { setModelStatsStore } from "@/server/llm-gateway/engine/host/modelStats";
import { DEFAULT_SMART_ROUTING_CONFIG } from "@/server/llm-gateway/engine/services/smart-routing/types";
import type { ModelStat } from "@/shared/observability/modelStats";

function profile(modelKey: string): SmartModelProfile {
  const [provider, ...rest] = modelKey.split("/");
  return {
    modelKey, provider, model: rest.join("/"), displayName: modelKey,
    capabilities: {
      serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false,
      imageOutput: false, audioOutput: false, tools: true, search: false, reasoning: false,
      contextWindow: 200_000, maxOutput: 32_000,
    },
    inputPrice: 1, outputPrice: 2, quality: 0.68, latencyScore: 0.7, reliabilityScore: 0.72,
    recommendedTier: "standard", needScores: { general: 0.8 }, source: "deterministic", inventoryFingerprint: modelKey,
  };
}

const combo = { id: "1", name: "dev", kind: "smart" as const, models: [], routing: DEFAULT_SMART_ROUTING_CONFIG };
const request = { combo, body: { messages: [{ role: "user", content: "explain how closures work in javascript please" }] } };

describe("smart ranking uses measured model behaviour", () => {
  afterEach(() => setModelStatsStore(null));

  it("keeps the prior order when nothing was measured", async () => {
    profiles = [profile("a/m"), profile("b/m")];
    const first = await resolveSmartRouting(request);
    expect(first.models).toEqual(["a/m", "b/m"]);
  });

  it("ranks a model that keeps failing below one that works", async () => {
    profiles = [profile("a/m"), profile("b/m")];
    const stats = new Map<string, ModelStat>([
      ["a/m", { okW: 5, failW: 195, ttftW: 0, ttftSamples: 0, samples: 200, p50Ms: null, p95Ms: null }],
      ["b/m", { okW: 200, failW: 0, ttftW: 0, ttftSamples: 0, samples: 200, p50Ms: null, p95Ms: null }],
    ]);
    setModelStatsStore({ record: () => {}, read: async () => stats });
    const result = await resolveSmartRouting(request);
    expect(result.models).toEqual(["b/m", "a/m"]);
  });

  it("ranks a slow-to-start model below a fast one", async () => {
    profiles = [profile("a/m"), profile("b/m")];
    const base = { okW: 40, failW: 0, ttftW: 40, ttftSamples: 40, samples: 40 };
    const stats = new Map<string, ModelStat>([
      ["a/m", { ...base, p50Ms: 32_000, p95Ms: 64_000 }],
      ["b/m", { ...base, p50Ms: 250, p95Ms: 500 }],
    ]);
    setModelStatsStore({ record: () => {}, read: async () => stats });
    expect((await resolveSmartRouting(request)).models).toEqual(["b/m", "a/m"]);
  });
});
