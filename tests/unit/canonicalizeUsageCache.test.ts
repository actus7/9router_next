import { describe, expect, it } from "vitest";
import { canonicalizeUsage } from "@/server/llm-gateway/engine/utils/usageTracking";

/**
 * Codex answering a Chat Completions client: the response translator rebuilds
 * the usage in Chat shape, where cache hits live in
 * `prompt_tokens_details.cached_tokens`. Storage only read a top-level
 * `cached_tokens`, so every such call was recorded with 0 cached tokens while
 * the client was told 16,128 — the dashboard showed 0% cache for a session
 * that was being cached all along, and its cost as if nothing were.
 */
describe("canonicalizeUsage reads cache hits in Chat Completions shape", () => {
  it("keeps prompt_tokens_details.cached_tokens", () => {
    const stored = canonicalizeUsage({
      prompt_tokens: 16349,
      completion_tokens: 52,
      total_tokens: 16401,
      prompt_tokens_details: { cached_tokens: 16128 },
      completion_tokens_details: { reasoning_tokens: 12 },
    });
    expect(stored).toMatchObject({ prompt_tokens: 16349, cached_tokens: 16128, reasoning_tokens: 12 });
  });

  it("still prefers an explicit top-level count", () => {
    expect(canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 1, cached_tokens: 80 })?.cached_tokens).toBe(80);
  });
});
