import { describe, expect, it, vi } from "vitest";

/**
 * Refreshing several Google accounts at once (and resolving each one's project
 * id on top) trips Google's anti-abuse limits (upstream decolua/9router
 * 1442cc7). Due connections are refreshed one at a time with a pause, longer
 * and jittered for antigravity / gemini-cli.
 */
vi.mock("@/lib/db/tenants", () => ({ forEachTenant: vi.fn() }));
vi.mock("@/server/llm-gateway/engine/services/tokenRefresh", () => ({ getRefreshLeadMs: () => 0 }));

import { runBackgroundTokenRefreshTick } from "@/server/llm-gateway/auth/backgroundTokenRefresh";

const expired = (id: string, provider: string) => ({
  id, provider, authType: "oauth", refreshToken: "rt", expiresAt: new Date(Date.now() - 1000).toISOString(),
});

describe("background token refresh", () => {
  it("refreshes due connections one at a time, pausing longer between Google accounts", async () => {
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const sleeps: number[] = [];

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [expired("a", "antigravity"), expired("b", "antigravity"), expired("c", "codex")],
      refreshConnection: async (conn) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        order.push(String(conn.id));
        await Promise.resolve();
        running -= 1;
      },
      sleep: async (ms: number) => { sleeps.push(ms); },
    });

    expect(order).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(12_000); // after an antigravity account
    expect(sleeps[1]).toBeGreaterThanOrEqual(12_000); // b is antigravity too
  });

  it("pauses briefly after a non-Google account", async () => {
    const sleeps: number[] = [];

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [expired("a", "codex"), expired("b", "codex")],
      refreshConnection: async () => {},
      sleep: async (ms: number) => { sleeps.push(ms); },
    });

    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeLessThan(5_000);
  });
});
