import { describe, expect, it } from "vitest";
import { extractRoutingSignals, peelRoutingEnvelope, scoreRoutingRequest } from "@/lib/open-sse/services/smart-routing/scoring";
import { normalizeSmartRoutingConfig, parseRoutingTierHeader, validateSmartRoutingConfig } from "@/lib/open-sse/services/smart-routing/router";

describe("smart routing scorer", () => {
  it("routes a short greeting to the simple tier", () => {
    const result = scoreRoutingRequest({ messages: [{ role: "user", content: "Oi" }] });
    expect(result.tier).toBe("simple");
    expect(result.reason).toBe("short_message");
  });

  it("forces formal proofs to reasoning in Portuguese", () => {
    const result = scoreRoutingRequest({ messages: [{ role: "user", content: "Demonstre por contradição que o teorema é válido." }] });
    expect(result.tier).toBe("reasoning");
    expect(result.reason).toBe("formal_logic_override");
  });

  it("detects coding tasks in Portuguese", () => {
    const result = scoreRoutingRequest({ messages: [{ role: "user", content: "Implemente e refatore esta API TypeScript com testes." }] });
    expect(result.need).toBe("coding");
    expect(result.needConfidence).toBeGreaterThan(0.6);
  });

  it("keeps tool requests at standard or above", () => {
    const result = scoreRoutingRequest({
      messages: [{ role: "user", content: "Veja isso" }],
      tools: [{ type: "function", function: { name: "lookup" } }],
    });
    expect(["standard", "complex", "reasoning"]).toContain(result.tier);
    expect(result.need).toBe("tool_use");
  });

  it("peels agent metadata envelopes before scoring", () => {
    const wrapped = 'Sender metadata:\n```json\n{"id":"agent"}\n```\n\nOi';
    expect(peelRoutingEnvelope(wrapped)).toBe("Oi");
    expect(scoreRoutingRequest({ messages: [{ role: "user", content: wrapped }] }).tier).toBe("simple");
  });

  it("raises very large contexts to at least complex", () => {
    const result = scoreRoutingRequest({ messages: [{ role: "user", content: "x".repeat(210_000) }] });
    expect(result.tier).toBe("complex");
    expect(result.reason).toBe("large_context");
  });

  it("extracts Responses and Gemini text shapes", () => {
    expect(extractRoutingSignals({ input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] }).lastUserText).toBe("hello");
    expect(extractRoutingSignals({ contents: [{ role: "user", parts: [{ text: "olá" }] }] }).lastUserText).toBe("olá");
  });
});

describe("smart routing configuration", () => {
  it("rejects invalid routing tier headers", () => {
    expect(parseRoutingTierHeader(new Headers({ "x-router-tier": "huge" })).error).toContain("Invalid x-router-tier");
    expect(parseRoutingTierHeader(new Headers({ "x-router-tier": "reasoning" })).tier).toBe("reasoning");
  });

  it("normalizes defaults and safe override model strings", () => {
    const config = normalizeSmartRoutingConfig({ overrides: { coding: { simple: ["oa/gpt", "invalid", "oa/gpt"] } } });
    expect(config.classifier.timeoutMs).toBe(5_000);
    expect(config.overrides.coding?.simple).toEqual(["oa/gpt"]);
  });

  it("validates confidence ranges", () => {
    expect(validateSmartRoutingConfig({ classifier: { confidenceThreshold: 2 } }).ok).toBe(false);
    expect(validateSmartRoutingConfig({ classifier: { confidenceThreshold: 0.45 } }).ok).toBe(true);
  });
});

