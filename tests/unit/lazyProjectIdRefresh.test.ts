import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Resolving the project id (onboardUser) eagerly after each refresh, across
 * several Google accounts at once, trips anti-abuse limits. The chat path
 * already resolves it on demand, so the refresh no longer does unless asked
 * (upstream decolua/9router 1442cc7).
 */
const getProjectIdForConnection = vi.hoisted(() => vi.fn(async () => "proj-1"));
vi.mock("@/server/llm-gateway/engine/services/projectId", () => ({
  getProjectIdForConnection,
  invalidateProjectId: vi.fn(),
}));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnectionById: vi.fn(async () => null),
  updateProviderConnection: vi.fn(async () => {}),
}));
vi.mock("@/server/llm-gateway/engine/services/oauthCredentialManager", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshProviderCredentials: vi.fn(async () => ({ accessToken: "at-new", refreshToken: "rt", expiresIn: 3600 })),
  shouldRefreshCredentials: () => true,
}));

import { checkAndRefreshToken } from "@/server/llm-gateway/auth/tokenRefresh";

const run = () => checkAndRefreshToken("antigravity", { id: "c1", refreshToken: "rt", accessToken: "at" } as never, { force: true });

beforeEach(() => getProjectIdForConnection.mockClear());

describe("project id after refresh", () => {
  it("is not resolved eagerly", async () => {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getProjectIdForConnection).not.toHaveBeenCalled();
  });

  it("is resolved when EAGER_PROJECT_ID_REFRESH=true", async () => {
    vi.stubEnv("EAGER_PROJECT_ID_REFRESH", "true");
    await run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    vi.unstubAllEnvs();

    expect(getProjectIdForConnection).toHaveBeenCalledTimes(1);
  });
});
