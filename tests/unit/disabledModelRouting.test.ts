import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

import {
  assertModelEnabled,
  isModelDisabled,
} from "@/server/llm-gateway/application/modelResolution";
import { getDisabledModels } from "@/lib/disabledModelsDb";

const getDisabledModelsMock = vi.mocked(getDisabledModels);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isModelDisabled", () => {
  it("matches a model disabled under the provider alias", async () => {
    // The dashboard stores disabled ids under the provider's alias.
    getDisabledModelsMock.mockResolvedValue({ cc: ["claude-sonnet-4.5"] });
    expect(await isModelDisabled("claude", "claude-sonnet-4.5")).toBe(true);
  });

  it("matches a model disabled under the raw provider id", async () => {
    // Older rows were keyed by the provider id, so both keys must be honoured.
    getDisabledModelsMock.mockResolvedValue({ claude: ["claude-sonnet-4.5"] });
    expect(await isModelDisabled("claude", "claude-sonnet-4.5")).toBe(true);
  });

  it("leaves other models of the same provider routable", async () => {
    getDisabledModelsMock.mockResolvedValue({ cc: ["claude-sonnet-4.5"] });
    expect(await isModelDisabled("claude", "claude-opus-4.5")).toBe(false);
  });

  it("treats an empty store as nothing disabled", async () => {
    getDisabledModelsMock.mockResolvedValue({});
    expect(await isModelDisabled("claude", "claude-sonnet-4.5")).toBe(false);
  });

  it("stays routable when the store cannot be read", async () => {
    // Failing closed here would take the whole gateway down with the store.
    getDisabledModelsMock.mockRejectedValue(new Error("db unavailable"));
    expect(await isModelDisabled("claude", "claude-sonnet-4.5")).toBe(false);
  });
});

describe("assertModelEnabled", () => {
  it("refuses a disabled model with 404 and names it", async () => {
    getDisabledModelsMock.mockResolvedValue({ cc: ["claude-sonnet-4.5"] });
    const response = await assertModelEnabled("claude", "claude-sonnet-4.5");
    expect(response?.status).toBe(404);
    await expect(response?.text()).resolves.toContain("claude/claude-sonnet-4.5");
  });

  it("admits an enabled model", async () => {
    getDisabledModelsMock.mockResolvedValue({});
    expect(await assertModelEnabled("claude", "claude-sonnet-4.5")).toBeNull();
  });
});
