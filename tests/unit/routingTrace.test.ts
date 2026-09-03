import { describe, expect, it } from "vitest";
import {
  ROUTING_TRACE_MAX_ERROR_CHARS,
  ROUTING_TRACE_MAX_HEADER_CHARS,
  parseRoutingTrace,
  serializeRoutingTrace,
  truncateTraceError,
  type RoutingTrace,
  type RoutingTraceStep,
} from "@/shared/observability/routingTrace";

function accountFailure(model: string, error: string): RoutingTraceStep {
  return { kind: "account", provider: "p", model, connection: "Public", outcome: "failed", status: 403, error };
}

function trace(steps: RoutingTraceStep[], selectedModel?: string): RoutingTrace {
  return { requestedModel: "chat", steps, ...(selectedModel ? { selectedModel } : {}) };
}

describe("routing trace serialization", () => {
  it("round-trips a small trace unchanged", () => {
    const original = trace([
      { kind: "smart", name: "chat", need: "general", tier: "standard", reason: "scored", candidates: ["a/one", "b/two"] },
      { kind: "account", provider: "b", model: "two", outcome: "selected", connection: "Public" },
    ], "b/two");
    const header = serializeRoutingTrace(original);
    expect(header).toBeTruthy();
    expect(parseRoutingTrace(header)).toEqual(original);
  });

  it("returns null when there is nothing to report", () => {
    expect(serializeRoutingTrace(trace([]))).toBeNull();
    expect(parseRoutingTrace(null)).toBeNull();
    expect(parseRoutingTrace("not json")).toBeNull();
  });

  it("escapes non latin-1 characters so the value is header-safe", () => {
    const header = serializeRoutingTrace(trace([accountFailure("m", "falhou: ação négligée")]));
    expect(header).toBeTruthy();
    expect(/[^\u0000-\u007f]/.test(header as string)).toBe(false);
    expect(parseRoutingTrace(header)?.steps[0]).toMatchObject({ error: "falhou: ação négligée" });
  });

  it("keeps the candidate list by shortening errors first", () => {
    const long = "x".repeat(ROUTING_TRACE_MAX_ERROR_CHARS);
    const header = serializeRoutingTrace(trace([
      { kind: "smart", name: "chat", need: "general", tier: "standard", candidates: ["a/one", "b/two", "c/three"] },
      ...Array.from({ length: 10 }, (_, index) => accountFailure(`m${index}`, long)),
    ]));
    const parsed = parseRoutingTrace(header);
    expect((parsed?.steps[0] as { candidates: string[] }).candidates).toEqual(["a/one", "b/two", "c/three"]);
    expect(parsed?.truncated).toBeUndefined();
  });

  // An emptied list read as "routing found no candidates" sends debugging the
  // wrong way, so dropping the lists must always be visible to the reader.
  it("flags the trace as truncated whenever lists are dropped", () => {
    const long = "y".repeat(ROUTING_TRACE_MAX_ERROR_CHARS);
    const header = serializeRoutingTrace(trace([
      { kind: "smart", name: "chat", need: "general", tier: "standard", candidates: ["a/one"] },
      ...Array.from({ length: 40 }, (_, index) => accountFailure(`model-number-${index}`, long)),
    ]));
    expect((header as string).length).toBeLessThanOrEqual(ROUTING_TRACE_MAX_HEADER_CHARS);
    const parsed = parseRoutingTrace(header);
    expect(parsed?.truncated).toBe(true);
    expect((parsed?.steps[0] as { candidates: string[] }).candidates).toEqual([]);
  });

  it("keeps the requested and selected model even when every step is dropped", () => {
    const header = serializeRoutingTrace(trace(
      Array.from({ length: 60 }, (_, index) => accountFailure(`a-fairly-long-model-name-${index}`, "z".repeat(ROUTING_TRACE_MAX_ERROR_CHARS))),
      "p/winner",
    ));
    expect((header as string).length).toBeLessThanOrEqual(ROUTING_TRACE_MAX_HEADER_CHARS);
    const parsed = parseRoutingTrace(header);
    expect(parsed?.requestedModel).toBe("chat");
    expect(parsed?.selectedModel).toBe("p/winner");
    expect(parsed?.truncated).toBe(true);
  });

  it("drops unknown step kinds when parsing", () => {
    const parsed = parseRoutingTrace(JSON.stringify({
      requestedModel: "chat",
      steps: [{ kind: "mystery" }, { kind: "account", provider: "p", model: "m", outcome: "selected" }],
    }));
    expect(parsed?.steps).toHaveLength(1);
  });
});

describe("truncateTraceError", () => {
  it("caps long messages and ignores empty ones", () => {
    expect(truncateTraceError("short")).toBe("short");
    expect(truncateTraceError(new Error("boom"))).toBe("boom");
    expect(truncateTraceError("   ")).toBeUndefined();
    expect(truncateTraceError(undefined)).toBeUndefined();
    const capped = truncateTraceError("q".repeat(ROUTING_TRACE_MAX_ERROR_CHARS + 50));
    expect(capped).toHaveLength(ROUTING_TRACE_MAX_ERROR_CHARS);
    expect(capped?.endsWith("…")).toBe(true);
  });
});
