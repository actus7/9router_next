import { describe, expect, it } from "vitest";
import { checkFallbackError } from "@/server/llm-gateway/engine/services/accountFallback";

/**
 * Z.ai answers an account with no balance with a 429. Treated as a rate limit
 * it got a 2s..5min backoff, so every request a few minutes later tried the
 * dead account again and lost 6-10s before falling back. A bill does not fix
 * itself in minutes: the account stays out for the billing cooldown.
 */
const ZAI = '[429]: {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}';
const THIRTY_MIN = 30 * 60 * 1000;

describe("billing errors keep the account out for long", () => {
  it("an out-of-balance 429 is a billing cooldown, not a rate-limit backoff", () => {
    const decision = checkFallbackError(429, ZAI, 0);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.cooldownMs).toBe(THIRTY_MIN);
    expect(decision.newBackoffLevel).toBeUndefined();
  });

  it("the billing text wins over a judge that calls it quota", () => {
    expect(checkFallbackError(429, ZAI, 0, { kind: "quota" } as never).cooldownMs).toBe(THIRTY_MIN);
  });

  it("a judge's billing verdict gets the same cooldown", () => {
    expect(checkFallbackError(400, "something about payment", 0, { kind: "billing" } as never).cooldownMs).toBe(THIRTY_MIN);
  });

  it("OpenAI's insufficient_quota and a 402 are billing too", () => {
    expect(checkFallbackError(429, '{"error":{"code":"insufficient_quota"}}', 0).cooldownMs).toBe(THIRTY_MIN);
    expect(checkFallbackError(402, "Payment required", 0).cooldownMs).toBe(THIRTY_MIN);
  });

  it("a plain rate limit keeps its short backoff", () => {
    const decision = checkFallbackError(429, "Too many requests", 0);
    expect(decision.cooldownMs).toBeLessThan(60_000);
    expect(decision.newBackoffLevel).toBe(1);
  });
});
