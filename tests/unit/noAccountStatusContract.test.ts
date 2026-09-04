import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "The operator configured no account for this provider" is one condition, so it
 * must carry one status code on every endpoint. It did not: chat answered 404
 * and embeddings answered 400, which is the drift three copies of the same
 * account-fallback loop produce.
 *
 * 404 is the correct one. The caller's request is well-formed — 400 blames the
 * client for a server-side configuration gap — and it matches the OpenAI
 * convention of 404 for a model that cannot be served.
 */

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({
    requireApiKey: false,
    comboStrategies: {},
    providerStrategies: {},
    freeFallbackEnabled: false,
  })),
}));
vi.mock("@/server/llm-gateway/auth/accountSelection", () => ({
  getProviderCredentials: vi.fn(async () => null),
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
vi.mock("@/server/llm-gateway/engine/handlers/embeddingsCore", () => ({
  handleEmbeddingsCore: vi.fn(),
}));
vi.mock("@/server/llm-gateway/auth/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider: string, creds: unknown) => creds),
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
vi.mock("@/lib/usageDb", () => ({
  saveRequestUsage: vi.fn(async () => {}),
}));

import { handleSingleModelChat } from "@/server/llm-gateway/application/chat";
import { handleEmbeddings } from "@/server/llm-gateway/application/embeddings";

beforeEach(() => {
  vi.clearAllMocks();
});

function embeddingsRequest(): Request {
  return new Request("http://localhost/api/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude/claude-sonnet-4.5", input: "hello" }),
  });
}

describe("provider with no active account", () => {
  it("answers 404 on the chat endpoint", async () => {
    const response = await handleSingleModelChat(
      { model: "claude/claude-sonnet-4.5" },
      "claude/claude-sonnet-4.5",
      null,
      null,
      null,
      // The free-default fallback would answer instead of erroring, and this
      // test is about the error contract, not the fallback.
      false,
    );

    expect(response.status).toBe(404);
  });

  it("answers 404 on the embeddings endpoint too", async () => {
    const response = await handleEmbeddings(embeddingsRequest());

    expect(response.status).toBe(404);
  });
});
