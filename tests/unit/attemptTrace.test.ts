import { describe, expect, it } from "vitest";
import {
  classifyAttemptError,
  summarizeRoutingTrace,
  type RoutingTrace,
  type RoutingTraceStep,
} from "@/shared/observability/routingTrace";

describe("classifyAttemptError", () => {
  it.each([
    [429, "Too many", "rate_limit"],
    [402, "pay", "billing"],
    [401, "bad key", "auth"],
    [403, "forbidden", "auth"],
    [503, "down", "transient"],
    [502, "bad gateway", "transient"],
    [504, "x", "timeout"],
    [408, "x", "timeout"],
    [400, "bad body", "client"],
    [200, "stream first-chunk timeout", "timeout"],
    [500, "stream stall timeout", "timeout"],
    [404, "nope", "other"],
  ])("status %s %s → %s", (status, text, expected) => {
    expect(classifyAttemptError(status, text)).toBe(expected);
  });
});

function attempt(over: Partial<Extract<RoutingTraceStep, { kind: "attempt" }>>): RoutingTraceStep {
  return { kind: "attempt", model: "a/m", index: 1, total: 3, outcome: "failed", ...over };
}

describe("summarizeRoutingTrace attempts", () => {
  it("carries every attempt in order with its detail", () => {
    const trace: RoutingTrace = {
      requestedModel: "dev",
      selectedModel: "c/m3",
      steps: [
        attempt({ model: "a/m1", index: 1, status: 429, error: "limit", errorClass: "rate_limit", durationMs: 120, startOffsetMs: 0 }),
        attempt({ model: "b/m2", index: 2, outcome: "cooldown_skip", errorClass: "cooldown", durationMs: 3, startOffsetMs: 125 }),
        attempt({ model: "c/m3", index: 3, outcome: "ok", durationMs: 900, startOffsetMs: 130 }),
      ],
    };
    const summary = summarizeRoutingTrace(trace)!;
    expect(summary.attempts?.map((a) => [a.model, a.outcome])).toEqual([
      ["a/m1", "failed"],
      ["b/m2", "cooldown_skip"],
      ["c/m3", "ok"],
    ]);
    expect(summary.attempts![0]).toMatchObject({ status: 429, errorClass: "rate_limit", durationMs: 120, provider: "a" });
    expect(summary.failed).toBe(1);
  });

  it("derives attempts from account steps when no combo attempt exists", () => {
    const trace: RoutingTrace = {
      requestedModel: "p/m",
      steps: [
        { kind: "account", provider: "p", model: "m", connection: "acc1", outcome: "switched", status: 429, error: "limit" },
        { kind: "account", provider: "p", model: "m", connection: "acc2", outcome: "selected" },
      ],
    };
    const summary = summarizeRoutingTrace(trace)!;
    expect(summary.attempts).toHaveLength(2);
    expect(summary.attempts![0]).toMatchObject({ outcome: "failed", connection: "acc1", status: 429 });
    expect(summary.attempts![1]).toMatchObject({ outcome: "ok", connection: "acc2" });
  });

  it("caps attempts and shortens errors", () => {
    const steps = Array.from({ length: 30 }, (_, i) =>
      attempt({ model: `a/m${i}`, index: i + 1, error: "x".repeat(400) }));
    const summary = summarizeRoutingTrace({ requestedModel: "dev", steps })!;
    expect(summary.attempts!.length).toBeLessThanOrEqual(12);
    expect(summary.attempts![0].error!.length).toBeLessThanOrEqual(120);
    expect(summary.truncated).toBe(true);
  });
});

describe("account rotation inside a model that answered", () => {
  const account = (over: Partial<Extract<RoutingTraceStep, { kind: "account" }>>): RoutingTraceStep =>
    ({ kind: "account", provider: "kilo-gateway", model: "kilo-auto/free", outcome: "selected", ...over });

  it("keeps the failed account even when the combo made a single, successful attempt", () => {
    const trace: RoutingTrace = {
      requestedModel: "dev",
      selectedModel: "kilo-gateway/kilo-auto/free",
      steps: [
        account({ connection: "acc-1", outcome: "switched", status: 429, error: "limit" }),
        account({ connection: "acc-2", outcome: "selected" }),
        attempt({ model: "kilo-gateway/kilo-auto/free", index: 1, total: 1, outcome: "ok", durationMs: 800 }),
      ],
    };
    const attempts = summarizeRoutingTrace(trace)?.attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts?.[0]).toMatchObject({ model: "kilo-gateway/kilo-auto/free", connection: "acc-1", outcome: "failed", status: 429 });
    expect(attempts?.[1]).toMatchObject({ outcome: "ok" });
  });

  it("does not duplicate account failures of a model whose combo attempt failed", () => {
    const trace: RoutingTrace = {
      requestedModel: "dev",
      steps: [
        account({ connection: "acc-1", outcome: "failed", status: 503 }),
        attempt({ model: "kilo-gateway/kilo-auto/free", outcome: "failed", status: 503 }),
        attempt({ model: "b/m2", index: 2, outcome: "ok" }),
      ],
    };
    expect(summarizeRoutingTrace(trace)?.attempts).toHaveLength(2);
  });
});
