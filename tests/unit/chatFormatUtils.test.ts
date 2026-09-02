import { describe, expect, it } from "vitest";
import { readStreamUsage } from "@/app/(dashboard)/dashboard/basic-chat/chatFormatUtils";

describe("readStreamUsage", () => {
  it("parses OpenAI-style nested cached tokens", () => {
    const result = readStreamUsage({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } } });
    expect(result).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 40 });
  });

  it("parses Anthropic-style flat cache_read_input_tokens", () => {
    const result = readStreamUsage({ usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 15 } });
    expect(result?.cached_tokens).toBe(15);
  });

  it("omits cached_tokens when the provider reports none", () => {
    const result = readStreamUsage({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    expect(result).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  });

  it("returns null when the chunk has no usage field", () => {
    expect(readStreamUsage({})).toBeNull();
  });
});
