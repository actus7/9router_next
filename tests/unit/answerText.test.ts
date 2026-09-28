import { describe, expect, it } from "vitest";
import { answerOf } from "@/server/llm-gateway/engine/utils/answerText";

// The Synapse Loop learns from the final answer in whatever dialect the client
// speaks — and must never learn from a turn that called a tool.
describe("answerOf", () => {
  it("OpenAI", () => {
    expect(answerOf({ choices: [{ message: { content: "Paris." } }] })).toEqual({ text: "Paris.", sawToolCall: false });
    expect(answerOf({ choices: [{ message: { content: "", tool_calls: [{ id: "c" }] } }] }).sawToolCall).toBe(true);
  });
  it("Anthropic", () => {
    expect(answerOf({ type: "message", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "Paris." }] })).toEqual({ text: "Paris.", sawToolCall: false });
    expect(answerOf({ type: "message", content: [{ type: "tool_use", id: "t" }] }).sawToolCall).toBe(true);
  });
  it("Responses", () => {
    expect(answerOf({ object: "response", output: [{ type: "message", content: [{ type: "output_text", text: "Paris." }] }] }).text).toBe("Paris.");
    expect(answerOf({ object: "response", output: [{ type: "function_call" }] }).sawToolCall).toBe(true);
  });
  it("Gemini", () => {
    expect(answerOf({ candidates: [{ content: { parts: [{ text: "Paris." }] } }] }).text).toBe("Paris.");
    expect(answerOf({ candidates: [{ content: { parts: [{ functionCall: { name: "f" } }] } }] }).sawToolCall).toBe(true);
  });
  it("forma desconhecida → vazio", () => {
    expect(answerOf(null)).toEqual({ text: "", sawToolCall: false });
  });
});
