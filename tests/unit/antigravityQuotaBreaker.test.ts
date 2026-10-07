import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Antigravity live-quota cache and 429 strike breaker (upstream decolua/9router
 * antigravityQuota.js, #3681): Google can report remaining quota while generation
 * keeps answering 429, so three strikes in a minute block the pair for 15 min.
 */
const getAntigravityUsage = vi.hoisted(() => vi.fn());
vi.mock("@/server/llm-gateway/engine/services/usage/google", () => ({ getAntigravityUsage }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import {
  antigravityQuotaBlockedUntil,
  clearAntigravityStrikes,
  handleAntigravityQuotaError,
} from "@/server/llm-gateway/auth/antigravityQuota";

const MODEL = "gemini-3.7-flash-high";
let seq = 0;
let conn: string;

beforeEach(() => {
  conn = `conn-${++seq}-aaaaaaaaaaaa`;
  getAntigravityUsage.mockReset();
  vi.useRealTimers();
});

describe("handleAntigravityQuotaError", () => {
  it("returns the exact resetAt when upstream says the model is exhausted", async () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    getAntigravityUsage.mockResolvedValue({ quotas: { [MODEL]: { remainingPercentage: 0, resetAt } } });

    const resetMs = await handleAntigravityQuotaError(conn, 429, MODEL, "at", {});

    expect(resetMs).toBe(new Date(resetAt).getTime());
    expect(antigravityQuotaBlockedUntil(conn, MODEL)).toBe(resetAt);
  });

  it("blocks the pair on the third optimistic 429, not before", async () => {
    getAntigravityUsage.mockResolvedValue({ quotas: { [MODEL]: { remainingPercentage: 80 } } });
    vi.useFakeTimers();
    const step = async () => {
      vi.advanceTimersByTime(10_000); // inside the 60s strike window
      return handleAntigravityQuotaError(conn, 429, MODEL, "at", {});
    };

    expect(await step()).toBeNull();
    expect(await step()).toBeNull();
    const blockedUntil = await step();

    expect(blockedUntil).toBeGreaterThan(Date.now());
    expect(antigravityQuotaBlockedUntil(conn, MODEL)).not.toBeNull();
  });

  it("a success clears the strikes so they have to be consecutive", async () => {
    getAntigravityUsage.mockResolvedValue({ quotas: { [MODEL]: { remainingPercentage: 80 } } });
    vi.useFakeTimers();
    const step = async () => {
      vi.advanceTimersByTime(10_000);
      return handleAntigravityQuotaError(conn, 429, MODEL, "at", {});
    };

    await step();
    await step();
    clearAntigravityStrikes(conn, MODEL);

    expect(await step()).toBeNull();
    expect(antigravityQuotaBlockedUntil(conn, MODEL)).toBeNull();
  });

  it("keeps the cache untouched when the usage call answers with an error message", async () => {
    getAntigravityUsage.mockResolvedValue({ quotas: {}, message: "403" });

    await handleAntigravityQuotaError(conn, 429, MODEL, "at", {});

    expect(antigravityQuotaBlockedUntil(conn, MODEL)).toBeNull();
  });
});
