import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluateJev = vi.fn();
const isJevFeatureEnabled = vi.fn();
vi.mock("@/server/decisions/jev", () => ({
  JEV_MODEL: "typesafe-ai/jev",
  evaluateJev: (...args: unknown[]) => evaluateJev(...args),
  isJevFeatureEnabled: (...args: unknown[]) => isJevFeatureEnabled(...args),
}));

import { buildJevClassifierCallback } from "@/server/llm-gateway/application/routingClassifier";

const answers = {
  tier: { type: "choice", choice: "complex", confidence: 0.9, probabilities: {} },
  need: { type: "choice", choice: "coding", confidence: 0.9, probabilities: {} },
};

beforeEach(() => {
  evaluateJev.mockReset().mockResolvedValue(answers);
  isJevFeatureEnabled.mockReset().mockResolvedValue(false);
});

describe("buildJevClassifierCallback", () => {
  it("stays off when the decision-engine flag is off and nobody chose a model", async () => {
    expect(await buildJevClassifierCallback()("hi", "general", 1000)).toBeNull();
    expect(evaluateJev).not.toHaveBeenCalled();
  });

  it("an explicit System One choice runs without the flag, on the chosen model", async () => {
    const result = await buildJevClassifierCallback()("hi", "general", 1000, { model: "typesafe-ai/laya", explicit: true });
    expect(evaluateJev.mock.calls[0][3]).toBe("typesafe-ai/laya");
    expect(result).toMatchObject({ tier: "complex", need: "coding", model: "typesafe-ai/laya" });
  });

  it("defaults to Jev when the flag is on", async () => {
    isJevFeatureEnabled.mockResolvedValue(true);
    const result = await buildJevClassifierCallback()("hi", "general", 1000);
    expect(result?.model).toBe("typesafe-ai/jev");
  });
});
