import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false, comboStrategies: {}, providerStrategies: {} })),
}));
vi.mock("@/server/llm-gateway/auth/accountSelection", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true, cooldownMs: 1000 })),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
vi.mock("@/server/llm-gateway/application/modelResolution", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "claude", model: "claude-sonnet-4.5" })),
  getComboModels: vi.fn(async () => null),
  assertModelEnabled: vi.fn(async () => null),
}));
vi.mock("@/server/llm-gateway/engine/handlers/chatCore", () => ({
  handleChatCore: vi.fn(),
}));
vi.mock("@/server/llm-gateway/auth/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider: string, credentials: unknown) => credentials),
  updateProviderCredentials: vi.fn(async () => {}),
}));
vi.mock("@/server/llm-gateway/engine/services/projectId", () => ({
  getProjectIdForConnection: vi.fn(async () => null),
}));
vi.mock("@/server/llm-gateway/engine/services/smart-routing/router", () => ({
  getSmartCombo: vi.fn(async () => null),
  resolveSmartRouting: vi.fn(),
  deriveRoutingSessionKey: vi.fn(() => "session"),
}));

import { handleSingleModelChat } from "@/server/llm-gateway/application/chat";
import {
  getProviderCredentials,
  markAccountUnavailable,
} from "@/server/llm-gateway/auth/accountSelection";
import { handleChatCore } from "@/server/llm-gateway/engine/handlers/chatCore";

const credentialsMock = vi.mocked(getProviderCredentials);
const markUnavailableMock = vi.mocked(markAccountUnavailable);
const coreMock = vi.mocked(handleChatCore);

/** Hand out one connection per call, then run dry. */
function connectionsInOrder(...ids: string[]): void {
  let index = 0;
  credentialsMock.mockImplementation(async () => {
    const id = ids[index++];
    return id ? { connectionId: id, connectionName: id } : null;
  });
}

function failure(status: number, error: string) {
  return {
    success: false,
    status,
    error,
    response: new Response(JSON.stringify({ error: { message: error } }), { status }),
  };
}

function success(text: string) {
  return { success: true, response: new Response(text, { status: 200 }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  markUnavailableMock.mockResolvedValue({ shouldFallback: true, cooldownMs: 1000 });
});

describe("account fallback loop", () => {
  it("rotates to the next account after a rate limit and returns its answer", async () => {
    connectionsInOrder("conn-a", "conn-b");
    coreMock
      .mockResolvedValueOnce(failure(429, "Too Many Requests") as never)
      .mockResolvedValueOnce(success("second account answered") as never);

    const response = await handleSingleModelChat({ model: "claude/claude-sonnet-4.5" }, "claude/claude-sonnet-4.5");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("second account answered");
    expect(coreMock).toHaveBeenCalledTimes(2);
    // The second attempt must exclude the account that just failed.
    expect(credentialsMock.mock.calls[1][1]).toEqual(new Set(["conn-a"]));
  });

  it("stops at the first account when the error is the client's fault", async () => {
    connectionsInOrder("conn-a", "conn-b");
    markUnavailableMock.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
    coreMock.mockResolvedValue(failure(400, "Invalid tool schema") as never);

    const response = await handleSingleModelChat({ model: "claude/claude-sonnet-4.5" }, "claude/claude-sonnet-4.5");

    expect(response.status).toBe(400);
    expect(coreMock).toHaveBeenCalledTimes(1);
  });

  it("reports the last upstream error once every account is spent", async () => {
    connectionsInOrder("conn-a", "conn-b");
    coreMock.mockResolvedValue(failure(502, "Bad Gateway") as never);

    const response = await handleSingleModelChat({ model: "claude/claude-sonnet-4.5" }, "claude/claude-sonnet-4.5");

    expect(coreMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
  });

  it("answers 404 when the provider has no active connection at all", async () => {
    connectionsInOrder();
    const response = await handleSingleModelChat({ model: "claude/claude-sonnet-4.5" }, "claude/claude-sonnet-4.5");

    expect(response.status).toBe(404);
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("refuses a disabled model before touching any credential", async () => {
    const { assertModelEnabled } = await import("@/server/llm-gateway/application/modelResolution");
    vi.mocked(assertModelEnabled).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "disabled" } }), { status: 404 }),
    );
    connectionsInOrder("conn-a");

    const response = await handleSingleModelChat({ model: "claude/claude-sonnet-4.5" }, "claude/claude-sonnet-4.5");

    expect(response.status).toBe(404);
    expect(credentialsMock).not.toHaveBeenCalled();
    expect(coreMock).not.toHaveBeenCalled();
  });
});
