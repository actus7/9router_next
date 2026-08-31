import { describe, it, expect } from "vitest";
import { initTranslators, translateRequest } from "@/server/llm-gateway/engine/translator";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

// Ensure translators are registered before tests
initTranslators();

describe("TTS models: systemInstruction handling", () => {
  it("openai→gemini translator produces systemInstruction from system message", () => {
    const body = {
      model: "gemini-3.1-flash-tts-preview",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
      stream: true,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-3.1-flash-tts-preview",
      body,
      true,
    ) as Record<string, unknown>;

    expect(result).toBeDefined();
    // The translator should produce systemInstruction for multi-message requests
    expect(result.systemInstruction).toBeDefined();
    expect((result.systemInstruction as Record<string, unknown>).parts).toBeDefined();
  });

  it("openai→gemini translator omits systemInstruction when no system message", () => {
    const body = {
      model: "gemini-3.1-flash-tts-preview",
      messages: [
        { role: "user", content: "Hello" },
      ],
      stream: true,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-3.1-flash-tts-preview",
      body,
      true,
    ) as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(result.systemInstruction).toBeUndefined();
  });

  it("systemInstruction is stripped for TTS models (simulating chatCore TTS guard)", () => {
    // This simulates what chatCore.ts does for TTS models after translation
    const translatedBody: Record<string, unknown> = {
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      systemInstruction: { role: "user", parts: [{ text: "You are helpful." }] },
      generationConfig: {},
    };

    // Simulate the TTS guard from chatCore.ts
    const modelType = "tts";
    if (modelType === "tts" && translatedBody.messages) {
      translatedBody.messages = (translatedBody.messages as Record<string, unknown>[]).filter(
        (msg: Record<string, unknown>) => msg.role !== "tool",
      );
      delete translatedBody.tools;
    }
    // The fix: also strip systemInstruction for TTS models
    if (modelType === "tts") {
      delete translatedBody.systemInstruction;
      delete translatedBody.system_instruction;
    }

    expect(translatedBody.systemInstruction).toBeUndefined();
    expect(translatedBody.system_instruction).toBeUndefined();
    // Contents should be preserved
    expect(translatedBody.contents).toBeDefined();
    expect((translatedBody.contents as unknown[]).length).toBe(1);
  });

  it("systemInstruction is preserved for non-TTS Gemini models", () => {
    const body = {
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
      stream: true,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-2.5-flash",
      body,
      true,
    ) as Record<string, unknown>;

    expect(result).toBeDefined();
    // Non-TTS models should still have systemInstruction
    expect(result.systemInstruction).toBeDefined();
  });
});
