import { describe, expect, it } from "vitest";

import { resolveAccountExhaustion } from "@/server/llm-gateway/engine/services/accountFallback";

/**
 * The three "no account left" outcomes used to be written inline in the chat
 * loop, the embeddings loop and the Gemini-native forwarder, and they drifted:
 * the same no-account-configured condition answered 404 on chat and 400 on
 * embeddings. One owner, asserted here.
 *
 * Only this decision is shared — not the loops, which genuinely differ (chat
 * carries the routing trace, the free-default fallback, project-id enrichment
 * and the noAuth cooldown; embeddings writes usage inline; the Gemini path
 * forwards rather than translates).
 */
describe("resolveAccountExhaustion", () => {
  it("reports 404 when nothing was ever tried — a configuration gap, not a failure", () => {
    const result = resolveAccountExhaustion("claude", "sonnet", null, 0, null, null);

    expect(result.kind).toBe("no-accounts");
    expect(result.status).toBe(404);
    // 400 would blame the caller for a well-formed request.
    expect(result.message).toContain("claude");
  });

  it("reports the cooldown with a Retry-After when every account is rate limited", () => {
    const result = resolveAccountExhaustion(
      "codex",
      "gpt-5",
      {
        allRateLimited: true,
        retryAfter: 1788500000000,
        retryAfterHuman: "in 3 minutes",
        lastError: "Too Many Requests",
        lastErrorCode: 429,
      },
      2,
      null,
      null,
    );

    expect(result.kind).toBe("rate-limited");
    if (result.kind !== "rate-limited") return;
    expect(result.status).toBe(429);
    expect(result.message).toBe("[codex/gpt-5] Too Many Requests");
    expect(result.retryAfterHuman).toBe("in 3 minutes");
  });

  it("prefers the error from this request over the one the selector cached", () => {
    const result = resolveAccountExhaustion(
      "codex",
      "gpt-5",
      { allRateLimited: true, lastError: "stale", lastErrorCode: 429 },
      1,
      "fresh failure",
      503,
    );

    if (result.kind !== "rate-limited") throw new Error("expected rate-limited");
    expect(result.message).toBe("[codex/gpt-5] fresh failure");
    expect(result.status).toBe(503);
  });

  it("falls back to 503 when the rate-limit report carries no status", () => {
    const result = resolveAccountExhaustion(
      "codex",
      "gpt-5",
      { allRateLimited: true },
      1,
      null,
      null,
    );

    expect(result.status).toBe(503);
  });

  it("reports exhaustion once accounts were tried and all failed", () => {
    const result = resolveAccountExhaustion("claude", "sonnet", null, 3, "502 Bad Gateway", 502);

    expect(result.kind).toBe("exhausted");
    expect(result.status).toBe(502);
    expect(result.message).toBe("502 Bad Gateway");
  });

  it("defaults exhaustion to 503 with a generic message", () => {
    const result = resolveAccountExhaustion("claude", "sonnet", null, 3, null, null);

    expect(result.status).toBe(503);
    expect(result.message).toBe("All accounts unavailable");
  });
});
