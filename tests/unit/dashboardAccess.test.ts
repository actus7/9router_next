import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(),
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: vi.fn(),
}));

import { cookies } from "next/headers";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { isLocalRequest } from "@/dashboardGuard";
import { hasDashboardAccess } from "@/lib/auth/dashboardAccess";

function withCookie(token?: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === "auth_token" && token ? { value: token } : undefined),
  } as never);
}

describe("hasDashboardAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue({} as never);
    vi.mocked(verifyDashboardAuthToken).mockResolvedValue(false);
    vi.mocked(isLocalRequest).mockReturnValue(false);
  });

  it("grants access with no cookie for a local caller when login is off", async () => {
    vi.mocked(getSettings).mockResolvedValue({ requireLogin: false } as never);
    vi.mocked(isLocalRequest).mockReturnValue(true);
    withCookie(undefined);

    await expect(hasDashboardAccess()).resolves.toBe(true);
  });

  // Login-off is a local single-user mode, exactly as src/proxy.ts treats it.
  it("still denies a remote caller when login is off", async () => {
    vi.mocked(getSettings).mockResolvedValue({ requireLogin: false } as never);
    vi.mocked(isLocalRequest).mockReturnValue(false);
    withCookie(undefined);

    await expect(hasDashboardAccess()).resolves.toBe(false);
  });

  it("denies access when login is required and no cookie is present", async () => {
    withCookie(undefined);

    await expect(hasDashboardAccess()).resolves.toBe(false);
  });

  it("denies access when the token does not verify", async () => {
    withCookie("tampered");

    await expect(hasDashboardAccess()).resolves.toBe(false);
    expect(verifyDashboardAuthToken).toHaveBeenCalledWith("tampered");
  });

  it("grants access for a verified token", async () => {
    withCookie("good");
    vi.mocked(verifyDashboardAuthToken).mockResolvedValue(true);

    await expect(hasDashboardAccess()).resolves.toBe(true);
  });

  it("fails closed when settings cannot be read", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("db down"));
    vi.mocked(isLocalRequest).mockReturnValue(true);
    withCookie(undefined);

    await expect(hasDashboardAccess()).resolves.toBe(false);
  });
});
