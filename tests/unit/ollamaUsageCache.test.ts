import { describe, expect, it } from "vitest";

import { toOpenAIUsage } from "@/server/llm-gateway/engine/translator/concerns/usage";

// Ollama reports prompt tokens cache-INCLUSIVE (like OpenAI/Gemini) and the cache-read
// part separately in `prompt_eval_cached_count`. Dropping it showed every Ollama call
// with no cache and the full prompt cost.
describe("Ollama usage", () => {
  it("reports prompt_eval_cached_count as cached tokens, inside the prompt total", () => {
    const usage = toOpenAIUsage({ prompt_eval_count: 1000, eval_count: 50, prompt_eval_cached_count: 800 }, "ollama");

    expect(usage).toMatchObject({ prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 });
    expect(usage?.prompt_tokens_details).toMatchObject({ cached_tokens: 800 });
  });

  it("leaves the cache out when there is none", () => {
    const usage = toOpenAIUsage({ prompt_eval_count: 10, eval_count: 2 }, "ollama");

    expect(usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
    expect(usage?.prompt_tokens_details?.cached_tokens ?? 0).toBe(0);
  });
});
