import { afterEach, describe, expect, it } from "vitest";

import { __resetRateLimits, consumeRateLimit } from "@/server/application/http/rateLimit";

afterEach(() => __resetRateLimits());

describe("rate limit", () => {
  it("allows up to the limit and refuses the next request", () => {
    for (let i = 0; i < 3; i++) {
      expect(consumeRateLimit("a", 3, 60_000).allowed, `request ${i + 1}`).toBe(true);
    }
    const blocked = consumeRateLimit("a", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts each key separately, so one account cannot starve another", () => {
    consumeRateLimit("a", 1, 60_000);
    expect(consumeRateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(consumeRateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("starts a fresh window once the old one has expired", () => {
    expect(consumeRateLimit("a", 1, 1).allowed).toBe(true);
    expect(consumeRateLimit("a", 1, 1).allowed).toBe(false);
    const start = Date.now();
    while (Date.now() === start) { /* spin past the 1ms window */ }
    expect(consumeRateLimit("a", 1, 1).allowed).toBe(true);
  });

  it("treats a limit of zero as disabled rather than as blocking everything", () => {
    for (let i = 0; i < 50; i++) expect(consumeRateLimit("a", 0, 60_000).allowed).toBe(true);
  });
});
