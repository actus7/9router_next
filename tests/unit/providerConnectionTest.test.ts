import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(async () => null),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false })),
}));
vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/api/providers/[id]/test/oauthTestUtils", () => ({
  testOAuthConnection: vi.fn(),
}));

import { testSingleConnection } from "@/app/api/providers/[id]/test/testUtils";
import { testOAuthConnection } from "@/app/api/providers/[id]/test/oauthTestUtils";
import {
  getProviderConnectionById,
  updateProviderConnection,
} from "@/models";

const getConnectionMock = vi.mocked(getProviderConnectionById);
const updateConnectionMock = vi.mocked(updateProviderConnection);
const probeMock = vi.mocked(testOAuthConnection);

/** A saved OAuth connection that the runtime has already penalised. */
function backedOffConnection() {
  return {
    id: "conn-1",
    provider: "claude",
    authType: "oauth",
    accessToken: "token",
    testStatus: "error",
    errorCode: 429,
    backoffLevel: 4,
    lastError: "Too Many Requests",
    lastErrorAt: "2026-09-03T12:00:00.000Z",
    providerSpecificData: {},
  };
}

function writtenFields(): Record<string, unknown> {
  expect(updateConnectionMock).toHaveBeenCalled();
  return updateConnectionMock.mock.calls.at(-1)![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getConnectionMock.mockResolvedValue(backedOffConnection() as never);
});

describe("testSingleConnection", () => {
  it("clears the runtime penalty when the connection passes", async () => {
    probeMock.mockResolvedValue({ ok: true, error: null, refreshed: false } as never);

    const result = await testSingleConnection("conn-1");

    expect(result.ok).toBe(true);
    const written = writtenFields();
    expect(written.testStatus).toBe("active");
    // A green test that leaves errorCode and backoffLevel in place shows the
    // operator "active" while the dispatcher still has the account backed off.
    expect(written.errorCode).toBeNull();
    expect(written.backoffLevel).toBe(0);
    expect(written.lastError).toBeNull();
    expect(written.lastErrorAt).toBeNull();
  });

  it("keeps the penalty untouched when the connection fails", async () => {
    probeMock.mockResolvedValue({ ok: false, error: "Invalid API key", refreshed: false } as never);

    const result = await testSingleConnection("conn-1");

    expect(result.ok).toBe(false);
    const written = writtenFields();
    expect(written.testStatus).toBe("error");
    expect(written.lastError).toBe("Invalid API key");
    // The runtime owns these two; a failed test must not invent a backoff.
    expect(written).not.toHaveProperty("backoffLevel");
    expect(written).not.toHaveProperty("errorCode");
  });

  it("reports latency and a timestamp for the caller", async () => {
    probeMock.mockResolvedValue({ ok: true, error: null, refreshed: false } as never);

    const result = await testSingleConnection("conn-1");

    expect(typeof result.latencyMs).toBe("number");
    expect(Number.isNaN(Date.parse(result.testedAt))).toBe(false);
  });

  it("keeps a soft warning as lastError without marking the connection broken", async () => {
    probeMock.mockResolvedValue({
      ok: true,
      error: null,
      refreshed: false,
      warning: "Spending limit reached",
    } as never);

    const result = await testSingleConnection("conn-1");

    expect(result.ok).toBe(true);
    const written = writtenFields();
    expect(written.testStatus).toBe("active");
    expect(written.lastError).toBe("Spending limit reached");
    // A soft warning still clears the dispatcher penalty: the credential works.
    expect(written.backoffLevel).toBe(0);
  });

  it("answers not found without writing anything", async () => {
    getConnectionMock.mockResolvedValue(null as never);

    const result = await testSingleConnection("missing");

    expect(result.error).toBe("Connection not found");
    expect(updateConnectionMock).not.toHaveBeenCalled();
    expect(probeMock).not.toHaveBeenCalled();
  });
});
