import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({
    requireApiKey: false,
    comboStrategies: {},
    providerStrategies: {},
  })),
}));
vi.mock("@/server/llm-gateway/auth/accountSelection", () => ({
  getProviderCredentials: vi.fn(async () => ({
    connectionId: "conn-1",
    connectionName: "Acct",
    apiKey: "upstream-key",
    providerSpecificData: {},
  })),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false, cooldownMs: 0 })),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
vi.mock("@/server/llm-gateway/application/modelResolution", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "openai", model: "text-embedding-3-small" })),
  assertModelEnabled: vi.fn(async () => null),
}));
vi.mock("@/server/llm-gateway/auth/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_p: string, creds: unknown) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
}));
vi.mock("@/server/llm-gateway/engine/services/smart-routing/router", () => ({
  getSmartCombo: vi.fn(async () => null),
  resolveSmartRouting: vi.fn(),
  deriveRoutingSessionKey: vi.fn(() => "session"),
}));
vi.mock("@/lib/usageDb", () => ({
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(() => {}),
}));

const handleEmbeddingsCore = vi.hoisted(() => vi.fn());
vi.mock("@/server/llm-gateway/engine/handlers/embeddingsCore", () => ({
  handleEmbeddingsCore,
}));

import { handleEmbeddings } from "@/server/llm-gateway/application/embeddings";
import { saveRequestDetail, saveRequestUsage } from "@/lib/usageDb";

function request(): Request {
  return new Request("http://localhost/api/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hello" }),
  });
}

function coreSuccess(usage: unknown) {
  handleEmbeddingsCore.mockResolvedValue({
    success: true,
    usage,
    response: new Response(JSON.stringify({ data: [] }), { status: 200 }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("embeddings accounting", () => {
  it("records a request detail, so an embedding is not invisible in the drill-down", async () => {
    coreSuccess({ prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 });

    const response = await handleEmbeddings(request());

    expect(response.status).toBe(200);
    // The Usage totals always showed embeddings; the request-detail tab never
    // did, so anyone debugging one concluded the call had not happened.
    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    const detail = vi.mocked(saveRequestDetail).mock.calls[0]![0] as Record<string, unknown>;
    expect(detail.provider).toBe("openai");
    expect(detail.model).toBe("text-embedding-3-small");
    expect(detail.connectionId).toBe("conn-1");
  });

  it("records an estimated usage report instead of silently counting zero", async () => {
    coreSuccess({ prompt_tokens: 11, completion_tokens: 0, estimated: true });

    await handleEmbeddings(request());

    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(saveRequestUsage).mock.calls[0]![0] as { tokens: Record<string, unknown> };
    expect(entry.tokens.prompt_tokens).toBe(11);
    // Flagged, so the UI can present it as approximate rather than exact.
    expect(entry.tokens.estimated).toBe(true);
    // Total derived when the provider omits it.
    expect(entry.tokens.total_tokens).toBe(11);
  });

  it("still rejects a usage report that is not usable at all", async () => {
    coreSuccess({ prompt_tokens: 0 });

    await handleEmbeddings(request());

    expect(saveRequestUsage).not.toHaveBeenCalled();
    // The detail is still written — the call happened either way.
    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
  });

  it("keeps an exact report unflagged", async () => {
    coreSuccess({ prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 });

    await handleEmbeddings(request());

    const entry = vi.mocked(saveRequestUsage).mock.calls[0]![0] as { tokens: Record<string, unknown> };
    expect(entry.tokens.estimated).toBeUndefined();
  });
});
