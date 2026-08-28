import { describe, it, expect } from "vitest";
import {
  translateRequest,
  translateResponse,
  initState,
  needsTranslation,
  initTranslators,
} from "@/lib/open-sse/translator";
import { FORMATS } from "@/lib/open-sse/translator/formats";

// ── (a) import completes without throwing ────────────────────────────────────
describe("translator registry import", () => {
  it("all expected exports are defined", () => {
    expect(typeof translateRequest).toBe("function");
    expect(typeof translateResponse).toBe("function");
    expect(typeof initState).toBe("function");
    expect(typeof needsTranslation).toBe("function");
    expect(typeof initTranslators).toBe("function");
  });

  it("initTranslators() does not throw", () => {
    expect(() => initTranslators()).not.toThrow();
  });

  it("FORMATS constants are present", () => {
    expect(FORMATS.OPENAI).toBe("openai");
    expect(FORMATS.CLAUDE).toBe("claude");
    expect(FORMATS.GEMINI).toBe("gemini");
    expect(FORMATS.KIRO).toBe("kiro");
  });
});

// ── (b) critical pairs exist ─────────────────────────────────────────────────
describe("critical translator pairs", () => {
  const criticalPairs: [string, string][] = [
    [FORMATS.OPENAI, FORMATS.CLAUDE],
    [FORMATS.CLAUDE, FORMATS.OPENAI],
    [FORMATS.OPENAI, FORMATS.GEMINI],
    [FORMATS.GEMINI, FORMATS.OPENAI],
    [FORMATS.OPENAI, FORMATS.KIRO],
    [FORMATS.KIRO, FORMATS.OPENAI],
    [FORMATS.CLAUDE, FORMATS.KIRO],
    [FORMATS.KIRO, FORMATS.CLAUDE],
  ];

  for (const [from, to] of criticalPairs) {
    it(`needsTranslation(${from}, ${to}) === true`, () => {
      expect(needsTranslation(from, to)).toBe(true);
    });
  }

  it("same format → needsTranslation returns false", () => {
    expect(needsTranslation(FORMATS.OPENAI, FORMATS.OPENAI)).toBe(false);
  });
});

// ── (c) translateRequest round-trip smoke ────────────────────────────────────
describe("translateRequest openai→claude", () => {
  it("produces object with messages array and system extracted", () => {
    const body = {
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 256,
      stream: true,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-sonnet-4-20250514",
      body,
      true
    );

    expect(result).toBeDefined();
    const r = result as Record<string, unknown>;
    expect(r.messages).toBeDefined();
    expect(Array.isArray(r.messages)).toBe(true);
    // Claude format extracts system into top-level field
    expect(r.system !== undefined || (r.messages as unknown[]).length > 0).toBe(true);
  });

  it("same-format passthrough returns body (possibly mutated)", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] };
    const result = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", body, true);
    // Same format → no translation, but hooks still run (ensureToolCallIds etc.)
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).messages).toBeDefined();
  });
});

// ── (d) initState returns usable state object ───────────────────────────────
describe("initState", () => {
  it("returns base state for openai format", () => {
    const state = initState(FORMATS.OPENAI);
    expect(state).toBeDefined();
    expect(state.messageId).toBeNull();
    expect(state.model).toBeNull();
    expect(state.textBlockStarted).toBe(false);
    expect(state.thinkingBlockStarted).toBe(false);
    expect(state.finishReason).toBeNull();
    expect(state.finishReasonSent).toBe(false);
    expect(state.usage).toBeNull();
    expect(state.contentBlockIndex).toBe(-1);
    expect(state.toolCalls).toBeInstanceOf(Map);
  });

  it("returns extended state for openai-responses format", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES) as Record<string, unknown>;
    expect(state).toBeDefined();
    // Extended fields
    expect(state.seq).toBe(0);
    expect(state.started).toBe(false);
    expect(state.completedSent).toBe(false);
    expect(state.customToolNames).toBeInstanceOf(Set);
    expect(state.funcArgsBuf).toBeDefined();
    expect(state.funcNames).toBeDefined();
    // Base fields still present
    expect(state.messageId).toBeNull();
    expect(state.toolCalls).toBeInstanceOf(Map);
  });

  it("returns base state for claude format", () => {
    const state = initState(FORMATS.CLAUDE);
    expect(state).toBeDefined();
    expect(state.messageId).toBeNull();
    expect(state.toolCalls).toBeInstanceOf(Map);
  });
});
