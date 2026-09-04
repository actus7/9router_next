import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false, comboStrategies: {}, providerStrategies: {}, freeFallbackEnabled: true })),
}));
vi.mock("@/server/llm-gateway/auth/accountSelection", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true, cooldownMs: 1000 })),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
// The real resolver reads the registry; here the alias prefix is the provider,
// which is enough to tell "the requested one" from "the free one" apart.
vi.mock("@/server/llm-gateway/application/modelResolution", () => ({
  getModelInfo: vi.fn(async (modelStr: string) => {
    const [alias, ...rest] = String(modelStr).split("/");
    return { provider: alias || null, model: rest.join("/") || String(modelStr) };
  }),
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

import { getSettings } from "@/lib/db/repos/settingsRepo";
import { handleSingleModelChat } from "@/server/llm-gateway/application/chat";
import { getProviderCredentials } from "@/server/llm-gateway/auth/accountSelection";
import { handleChatCore } from "@/server/llm-gateway/engine/handlers/chatCore";
import {
  FREE_DEFAULT_MODEL_KEY,
  FREE_DEFAULT_PROVIDER_ALIAS,
  isFreeDefaultProvider,
} from "@/shared/constants/freeDefault";

const credentialsMock = vi.mocked(getProviderCredentials);
const coreMock = vi.mocked(handleChatCore);
const settingsMock = vi.mocked(getSettings);

type Settings = Awaited<ReturnType<typeof getSettings>>;

function settings(freeFallbackEnabled: boolean): Settings {
  return { requireApiKey: false, comboStrategies: {}, providerStrategies: {}, freeFallbackEnabled } as Settings;
}

function body(model: string) {
  return { model, messages: [{ role: "user", content: "hi" }] };
}

function providersAsked(): string[] {
  return credentialsMock.mock.calls.map((call) => String(call[0]));
}

describe("gateway last-resort free fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.mockResolvedValue(settings(true));
  });

  it("answers through the free default when the requested provider has no account", async () => {
    credentialsMock.mockImplementation(async (provider: string) =>
      isFreeDefaultProvider(provider) ? { connectionId: "noauth", connectionName: "Public" } : null);
    coreMock.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
    } as Awaited<ReturnType<typeof handleChatCore>>);

    const response = await handleSingleModelChat(body("openai/gpt-5"), "openai/gpt-5");

    expect(response.status).toBe(200);
    expect(providersAsked()).toContain(FREE_DEFAULT_PROVIDER_ALIAS);
  });

  it("returns the original error when the operator turned the fallback off", async () => {
    settingsMock.mockResolvedValue(settings(false));
    credentialsMock.mockResolvedValue(null);

    const response = await handleSingleModelChat(body("openai/gpt-5"), "openai/gpt-5");

    expect(response.status).toBe(404);
    expect(providersAsked()).not.toContain(FREE_DEFAULT_PROVIDER_ALIAS);
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("keeps the original upstream error when the free default also fails", async () => {
    // Requested provider spends its one account on a 502; the free one has
    // none. The account must be handed out once and then run dry — a mock that
    // ignores excludeConnectionIds spins the fallback loop forever.
    const ids = ["conn-a"];
    let index = 0;
    credentialsMock.mockImplementation(async (provider: string) => {
      if (isFreeDefaultProvider(provider)) return null;
      const id = ids[index++];
      return id ? { connectionId: id, connectionName: id } : null;
    });
    coreMock.mockResolvedValue({
      success: false,
      status: 502,
      error: "upstream exploded",
      response: new Response(JSON.stringify({ error: { message: "upstream exploded" } }), { status: 502 }),
    } as Awaited<ReturnType<typeof handleChatCore>>);

    const response = await handleSingleModelChat(body("openai/gpt-5"), "openai/gpt-5");

    // Not the free provider's 404: the caller has to see why their own
    // provider failed.
    expect(response.status).toBe(502);
  });

  it("does not retry itself when the free provider is the one that failed", async () => {
    credentialsMock.mockResolvedValue(null);

    const response = await handleSingleModelChat(body(FREE_DEFAULT_MODEL_KEY), FREE_DEFAULT_MODEL_KEY);

    expect(response.status).toBe(404);
    // One lookup, and no second attempt at the same provider.
    expect(credentialsMock).toHaveBeenCalledTimes(1);
  });
});
