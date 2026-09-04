import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(),
}));
vi.mock("@/server/llm-gateway/auth/accountSelection", () => ({
  isValidApiKey: vi.fn(),
}));

import { requireGatewayApiKey } from "@/server/llm-gateway/application/gatewayApiKey";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { isValidApiKey } from "@/server/llm-gateway/auth/accountSelection";

const getSettingsMock = vi.mocked(getSettings);
const isValidApiKeyMock = vi.mocked(isValidApiKey);

function withRequireApiKey(required: boolean): void {
  getSettingsMock.mockResolvedValue({ requireApiKey: required } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireGatewayApiKey", () => {
  it("rejects a request with no key when the gate is on", async () => {
    withRequireApiKey(true);
    const response = await requireGatewayApiKey(null);
    expect(response?.status).toBe(401);
    expect(isValidApiKeyMock).not.toHaveBeenCalled();
  });

  it("rejects a key the store does not recognise", async () => {
    withRequireApiKey(true);
    isValidApiKeyMock.mockResolvedValue(false);
    const response = await requireGatewayApiKey("sk-unknown");
    expect(response?.status).toBe(401);
  });

  it("admits a recognised key", async () => {
    withRequireApiKey(true);
    isValidApiKeyMock.mockResolvedValue(true);
    expect(await requireGatewayApiKey("sk-known")).toBeNull();
  });

  it("admits any request when the gate is off, without touching the key store", async () => {
    withRequireApiKey(false);
    expect(await requireGatewayApiKey(null)).toBeNull();
    expect(isValidApiKeyMock).not.toHaveBeenCalled();
  });
});
