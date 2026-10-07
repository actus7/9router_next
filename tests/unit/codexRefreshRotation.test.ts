import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OpenAI rotates the refresh token on every refresh and revokes the whole
 * session when a rotated one is reused. A 5-day lead refreshed on every call,
 * and writers holding stale snapshots (usage poll, auto-ping, the background
 * refresher) reused tokens — logging the account out (upstream decolua/9router
 * 0bc7f86). Refresh only near real expiry, and from the freshest tokens.
 */
const refreshProviderCredentials = vi.hoisted(() => vi.fn());
const getProviderConnectionById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnectionById,
  updateProviderConnection: vi.fn(async () => {}),
}));
vi.mock("@/server/llm-gateway/engine/services/oauthCredentialManager", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshProviderCredentials,
  shouldRefreshCredentials: () => true,
}));

import { getRefreshLeadMs } from "@/server/llm-gateway/engine/services/tokenRefresh";
import { checkAndRefreshToken } from "@/server/llm-gateway/auth/tokenRefresh";

beforeEach(() => {
  refreshProviderCredentials.mockReset().mockResolvedValue(null);
  getProviderConnectionById.mockReset();
});

describe("codex refresh", () => {
  it("refreshes only within minutes of expiry, not days", () => {
    expect(getRefreshLeadMs("codex")).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("refreshes with the newer tokens another writer already stored", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c1", refreshToken: "rt-new", accessToken: "at-new",
      expiresAt: "2099-01-01T00:00:00.000Z", lastRefreshAt: "2026-10-07T10:00:00.000Z",
    });

    await checkAndRefreshToken("codex", {
      id: "c1", refreshToken: "rt-old", accessToken: "at-old", lastRefreshAt: "2026-10-07T09:00:00.000Z",
    } as never, { force: true });

    expect(refreshProviderCredentials.mock.calls[0][1]).toMatchObject({ refreshToken: "rt-new" });
  });

  it("keeps its own tokens when the stored ones are not newer", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c1", refreshToken: "rt-stored", lastRefreshAt: "2026-10-07T08:00:00.000Z",
    });

    await checkAndRefreshToken("codex", {
      id: "c1", refreshToken: "rt-mine", lastRefreshAt: "2026-10-07T09:00:00.000Z",
    } as never, { force: true });

    expect(refreshProviderCredentials.mock.calls[0][1]).toMatchObject({ refreshToken: "rt-mine" });
  });
});
