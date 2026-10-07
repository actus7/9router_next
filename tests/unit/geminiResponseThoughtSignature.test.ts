import { beforeEach, describe, expect, it } from "vitest";

import { geminiToOpenAIResponse } from "@/server/llm-gateway/engine/translator/response/gemini-to-openai";
import { _clearThoughtSignatures, getGeminiThoughtSignatureSync } from "@/server/llm-gateway/engine/services/thoughtSignatureStore";

/**
 * The signature Gemini attaches to a function call is kept under the call's id
 * so the next request can replay it; the id the client sees is the provider's.
 */
beforeEach(() => _clearThoughtSignatures());

const chunk = (parts: unknown[]) => ({
  response: { responseId: "r1", modelVersion: "gemini-3.1-pro-low", candidates: [{ content: { parts } }] },
});

function toolCallIds(results: Array<Record<string, unknown>> | null): string[] {
  return (results ?? []).flatMap((r) => {
    const choices = (r.choices as Array<{ delta?: { tool_calls?: Array<{ id: string }> } }> | undefined) ?? [];
    return choices.flatMap((c) => (c.delta?.tool_calls ?? []).map((t) => t.id));
  });
}

describe("gemini → openai thought signatures", () => {
  it("stores the signature of a signed function call under the provider's call id", () => {
    const state: Record<string, unknown> = { sessionId: "s1", model: "gemini-3.1-pro-low" };

    const out = geminiToOpenAIResponse(chunk([
      { thoughtSignature: "sig-1", functionCall: { id: "call-9", name: "read_file", args: {} } },
    ]), state) as unknown as Array<Record<string, unknown>>;

    expect(toolCallIds(out)).toEqual(["call-9"]);
    expect(getGeminiThoughtSignatureSync("call-9", "s1", "gemini-3.1-pro-low")).toBe("sig-1");
  });

  it("carries a standalone signature part over to the next function call", () => {
    const state: Record<string, unknown> = { sessionId: "s1", model: "gemini-3.1-pro-low" };

    geminiToOpenAIResponse(chunk([
      { thoughtSignature: "sig-2", text: "" },
      { functionCall: { id: "call-10", name: "read_file", args: {} } },
    ]), state);

    expect(getGeminiThoughtSignatureSync("call-10", "s1", "gemini-3.1-pro-low")).toBe("sig-2");
  });

  it("falls back to a generated id when the provider sends none", () => {
    const out = geminiToOpenAIResponse(chunk([
      { functionCall: { name: "read_file", args: {} } },
    ]), { sessionId: "s1" }) as unknown as Array<Record<string, unknown>>;

    expect(toolCallIds(out)[0]).toMatch(/^read_file-\d+-0$/);
  });
});
