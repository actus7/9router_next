import { describe, expect, it, vi } from "vitest";

/**
 * Codex says exactly when an exhausted account comes back (`resets_at` in its
 * 429). The cooldown was capped at 30 minutes on top of that, so an account
 * resetting in 3h was tried again every 30 minutes — every request at that
 * moment paid a round trip per account — and the error told the caller
 * "reset after 29m" for a limit that lasted hours.
 */
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async () => []),
  setModelAvailability: vi.fn(async () => {}),
  clearModelAvailability: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "c1", provider: "codex" }]),
  updateProviderConnection: vi.fn(async () => {}),
}));

import { markAccountUnavailable } from "@/server/llm-gateway/auth/accountSelection";

const HOUR = 60 * 60 * 1000;

describe("provider-reported reset time", () => {
  it("keeps the account out until the provider says it resets", async () => {
    const { cooldownMs } = await markAccountUnavailable("c1", 429, "The usage limit has been reached", "codex", "gpt-6.1-sol", Date.now() + 3 * HOUR);
    expect(cooldownMs).toBeGreaterThan(2.9 * HOUR);
  });

  it("still bounds an absurd reset time", async () => {
    const { cooldownMs } = await markAccountUnavailable("c1", 429, "The usage limit has been reached", "codex", "gpt-6.1-sol", Date.now() + 365 * 24 * HOUR);
    expect(cooldownMs).toBeLessThanOrEqual(8 * 24 * HOUR);
  });
});
