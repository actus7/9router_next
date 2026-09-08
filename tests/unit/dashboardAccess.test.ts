import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/application/http/tenantRoute", () => ({
  currentUserId: vi.fn(),
}));

import { currentUserId } from "@/server/application/http/tenantRoute";
import { hasDashboardAccess } from "@/lib/auth/dashboardAccess";

/**
 * The gate for handlers that act with an account's authority.
 *
 * It used to have a third answer besides yes and no: a local caller with login
 * turned off. That mode is gone — there is no instance-wide owner any more,
 * only accounts — so the only question left is whether there is a session.
 */
describe("hasDashboardAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grants access to a signed-in account", async () => {
    vi.mocked(currentUserId).mockResolvedValue("user_123");
    await expect(hasDashboardAccess()).resolves.toBe(true);
  });

  it("denies access when there is no session", async () => {
    vi.mocked(currentUserId).mockResolvedValue(null);
    await expect(hasDashboardAccess()).resolves.toBe(false);
  });
});
