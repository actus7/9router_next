import { describe, expect, it } from "vitest";
import {
  chatComboModelsError,
  findNonChatModels,
  isChatComboKind,
} from "@/server/application/use-cases/http/combos/chatComboModels";

describe("chat combo model validation", () => {
  it("treats missing, llm and smart kinds as chat combos", () => {
    expect(isChatComboKind(null)).toBe(true);
    expect(isChatComboKind(undefined)).toBe(true);
    expect(isChatComboKind("llm")).toBe(true);
    expect(isChatComboKind("smart")).toBe(true);
    expect(isChatComboKind("webSearch")).toBe(false);
    expect(isChatComboKind("tts")).toBe(false);
  });

  it("rejects models whose provider only offers other services", () => {
    expect(findNonChatModels(["anysearch/anysearch", "ctx7/context7", "toll/gemini_3_pro"]))
      .toEqual(["anysearch/anysearch", "ctx7/context7"]);
  });

  it("accepts providers that do chat alongside other services", () => {
    expect(findNonChatModels(["gemini/gemini-2.5-flash", "perplexity/sonar", "groq/llama-3.3-70b-versatile"])).toEqual([]);
  });

  it("leaves unknown providers and bare names alone", () => {
    expect(findNonChatModels(["my-node/some-model", "just-a-name", ""])).toEqual([]);
  });

  it("also checks models buried in smart routing overrides", () => {
    const routing = {
      overrides: {
        web_search: { default: ["anysearch/anysearch"] },
        general: { standard: ["toll/gemini_3_pro"] },
      },
    };
    expect(findNonChatModels([], routing)).toEqual(["anysearch/anysearch"]);
  });

  it("names the offending models in the error and stays quiet for non-chat combos", () => {
    const error = chatComboModelsError("smart", ["anysearch/anysearch"], null);
    expect(error).toContain("anysearch/anysearch");
    expect(chatComboModelsError("llm", ["groq/llama-3.3-70b-versatile"], null)).toBeNull();
    expect(chatComboModelsError("webSearch", ["anysearch/anysearch"], null)).toBeNull();
  });
});
