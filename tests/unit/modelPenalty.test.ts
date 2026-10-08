import { beforeEach, describe, expect, it } from "vitest";
import {
  clearModelPenalties,
  getModelPenalty,
  getStickyModel,
  orderByPenalty,
  recordModelFailure,
  recordModelSuccess,
  rememberStickyModel,
  snapshotModelPenalties,
} from "@/server/llm-gateway/engine/services/modelPenalty";

const MIN = 60_000;

describe("model penalty", () => {
  beforeEach(() => clearModelPenalties());

  it("weighs a 429 heavier than another failure and caps the total", () => {
    recordModelFailure("a/m", 429, 0);
    expect(getModelPenalty("a/m", 0)).toBe(3);
    recordModelFailure("b/m", 503, 0);
    expect(getModelPenalty("b/m", 0)).toBe(1);
    for (let i = 0; i < 10; i++) recordModelFailure("c/m", 429, 0);
    expect(getModelPenalty("c/m", 0)).toBe(10);
  });

  it("decays one point every two minutes and never goes negative", () => {
    recordModelFailure("a/m", 429, 0);
    expect(getModelPenalty("a/m", 2 * MIN)).toBe(2);
    expect(getModelPenalty("a/m", 4 * MIN)).toBe(1);
    expect(getModelPenalty("a/m", 60 * MIN)).toBe(0);
  });

  it("a success pays one point back", () => {
    recordModelFailure("a/m", 429, 0);
    recordModelSuccess("a/m", 0);
    expect(getModelPenalty("a/m", 0)).toBe(2);
  });

  it("orders by position plus penalty, keeping the user's order for equals", () => {
    recordModelFailure("a/m", 429, 0);
    expect(orderByPenalty(["a/m", "b/m", "c/m"], 0)).toEqual(["b/m", "c/m", "a/m"]);
    expect(orderByPenalty(["x/m", "y/m"], 0)).toEqual(["x/m", "y/m"]);
  });

  it("a one-point penalty only swaps neighbours", () => {
    recordModelFailure("a/m", 500, 0);
    expect(orderByPenalty(["a/m", "b/m", "c/m"], 0)).toEqual(["b/m", "a/m", "c/m"]);
  });

  it("reports only models still carrying a penalty", () => {
    recordModelFailure("a/m", 429, 0);
    recordModelFailure("b/m", 500, 0);
    expect(snapshotModelPenalties(0).map((r) => r.model)).toEqual(["a/m", "b/m"]);
    expect(snapshotModelPenalties(10 * MIN)).toEqual([]);
  });
});

describe("sticky model", () => {
  beforeEach(() => clearModelPenalties());

  it("remembers the model that answered for 30 minutes", () => {
    rememberStickyModel("sess", "dev", "b/m", 0);
    expect(getStickyModel("sess", "dev", 29 * MIN)).toBe("b/m");
    expect(getStickyModel("sess", "dev", 31 * MIN)).toBeUndefined();
  });

  it("is scoped to the session and the combo", () => {
    rememberStickyModel("sess", "dev", "b/m", 0);
    expect(getStickyModel("other", "dev", 0)).toBeUndefined();
    expect(getStickyModel("sess", "other-combo", 0)).toBeUndefined();
  });

  it("does nothing without a session key", () => {
    rememberStickyModel(undefined, "dev", "b/m", 0);
    expect(getStickyModel(undefined, "dev", 0)).toBeUndefined();
  });
});
