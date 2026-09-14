import { describe, expect, it } from "vitest";
import { applyMetaBreak } from "@/server/llm-gateway/engine/handlers/chatCore/metabreak";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

describe("MetaBreak behavioral profile", () => {
  it("adds operating instructions without fabricating assistant messages, including tool continuations", () => {
    const messages = [{ role: "system", content: "Use Portuguese." }, { role: "assistant", content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "read", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call1", content: "file contents" }];
    const body = { messages, tools: [{ type: "function" }], reasoning_effort: "high", response_format: { type: "json_object" } };
    const original = structuredClone(body);
    expect(applyMetaBreak(body, FORMATS.OPENAI).applied).toBe(true);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].content).toContain("Use Portuguese.");
    expect(body.messages[0].content).toContain("METABREAK OPERATING PROFILE");
    expect(body.messages.slice(1)).toEqual(original.messages.slice(1));
    expect({ ...body, messages: [] }).toEqual({ ...original, messages: [] });
    expect(messages).toEqual(original.messages);
    const once = structuredClone(body);
    expect(applyMetaBreak(body, FORMATS.OPENAI).reason).toBe("already-applied");
    expect(body).toEqual(once);
  });

  it("preserves developer text parts and uses the Chat Completions text type", () => {
    const body = { messages: [{ role: "developer", content: [{ type: "text", text: "Return JSON." }] }, { role: "user", content: [{ type: "image_url", image_url: { url: "data:test" } }] }] };
    const original = structuredClone(body.messages);
    applyMetaBreak(body, FORMATS.OPENAI);
    expect(body.messages[0].role).toBe("developer");
    expect(body.messages[0].content[0]).toEqual(original[0].content[0]);
    expect(body.messages[0].content[1]).toMatchObject({ type: "text" });
    expect(body.messages[1]).toEqual(original[1]);
  });

  it.each([FORMATS.OPENAI_RESPONSES, FORMATS.CODEX])("preserves reasoning, tools, previous response and output constraints in %s", format => {
    const body: Record<string, unknown> = { input: [{ type: "function_call_output", call_id: "call1", output: "ok" }], instructions: "Return valid JSON.", previous_response_id: "resp1", tools: [{ type: "function" }], reasoning: { effort: "high" }, text: { format: { type: "json_schema" } } };
    const original = structuredClone(body);
    expect(applyMetaBreak(body, format).applied).toBe(true);
    expect(body.instructions).toContain("Return valid JSON.");
    expect(body.instructions).toContain("METABREAK OPERATING PROFILE");
    expect({ ...body, instructions: "" }).toEqual({ ...original, instructions: "" });
    expect(applyMetaBreak(body, format).reason).toBe("already-applied");
  });

  it("handles Responses string input without requiring existing instructions", () => {
    const body: Record<string, unknown> = { input: "Explain recursion." };
    expect(applyMetaBreak(body, FORMATS.OPENAI_RESPONSES).applied).toBe(true);
    expect(body.input).toBe("Explain recursion.");
    expect(body.instructions).toContain("METABREAK OPERATING PROFILE");
  });

  it("supports Claude reasoning and preserves tool results and cache metadata", () => {
    const body = { model: "claude-sonnet-4-6", thinking: { type: "adaptive" }, system: [{ type: "text", text: "Base", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: "ok" }] }] };
    const original = structuredClone(body);
    expect(applyMetaBreak(body, FORMATS.CLAUDE).applied).toBe(true);
    expect(body.system.at(-1)).toEqual(original.system[0]);
    expect(body.messages).toEqual(original.messages);
    expect(body.thinking).toEqual(original.thinking);
    expect(applyMetaBreak(body, FORMATS.CLAUDE).reason).toBe("already-applied");
  });

  it.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY])("preserves Gemini tool parts and config: %s", format => {
    for (const key of ["systemInstruction", "system_instruction"]) {
      const request: Record<string, unknown> = { contents: [{ role: "user", parts: [{ functionResponse: { name: "read", response: { output: "ok" } } }] }], [key]: { parts: [{ text: "Base" }] }, generationConfig: { responseMimeType: "application/json" } };
      const body: Record<string, unknown> = format === FORMATS.ANTIGRAVITY ? { request } : request;
      const original = structuredClone(request);
      expect(applyMetaBreak(body, format).applied).toBe(true);
      const actual = (body.request ?? body) as Record<string, unknown>;
      expect(actual.contents).toEqual(original.contents);
      expect(actual.generationConfig).toEqual(original.generationConfig);
      expect((actual[key] as { parts: unknown[] }).parts).toHaveLength(2);
      expect(applyMetaBreak(body, format).reason).toBe("already-applied");
    }
  });

  it("fails open without changing unknown or malformed request shapes", () => {
    for (const [format, body] of [[FORMATS.KIRO, { conversationState: {} }], ["unknown", { messages: [] }], [FORMATS.OPENAI, null], [FORMATS.OPENAI, {}], [FORMATS.CLAUDE, { messages: [], system: 10 }]] as const) {
      const original = structuredClone(body);
      expect(applyMetaBreak(body as Record<string, unknown>, format).applied).toBe(false);
      expect(body).toEqual(original);
    }
  });
});
