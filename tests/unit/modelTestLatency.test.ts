import { describe, expect, it } from "vitest";
import { sortModelsByTestLatency } from "@/shared/utils/modelTestLatency";

describe("sortModelsByTestLatency", () => {
  it("places successfully tested models first by their response time, then keeps alphabetical order", () => {
    const models = [
      { id: "oc/laguna-s-2.1-free", name: "Laguna" },
      { id: "oc/big-pickle", name: "Big Pickle" },
      { id: "oc/mimo-v2.5-free", name: "MiMo" },
      { id: "oc/ling-3.0-flash-fin-free", name: "Ling" },
    ];

    expect(sortModelsByTestLatency(models, {
      "oc/mimo-v2.5-free": { latencyMs: 6701, testedAt: "2026-09-01T12:00:00.000Z" },
      "oc/ling-3.0-flash-fin-free": { latencyMs: 3364, testedAt: "2026-09-01T12:00:00.000Z" },
    }).map((model) => model.id)).toEqual([
      "oc/ling-3.0-flash-fin-free",
      "oc/mimo-v2.5-free",
      "oc/big-pickle",
      "oc/laguna-s-2.1-free",
    ]);
  });
});
