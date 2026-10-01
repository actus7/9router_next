import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsConfig";
import { listConnectionModels } from "@/server/application/use-cases/http/providers/[id]/models/listConnectionModels";
import { getDefaultModel, getModelSupportedFormats } from "@/server/llm-gateway/engine/config/providerModels";

/**
 * opencode-go answers a standard OpenAI listing at /zen/go/v1/models — the
 * detail page used to hit "Provider opencode-go does not support models
 * listing" because no PROVIDER_MODELS_CONFIG entry existed at all.
 */
const listing = {
  object: "list",
  data: [
    { id: "kimi-k3", object: "model", created: 1790892687, owned_by: "opencode" },
    { id: "glm-5.3", object: "model", created: 1790892687, owned_by: "opencode" },
    { id: "qwen3.8-max", object: "model", created: 1790892687, owned_by: "opencode" },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("opencode-go models listing", () => {
  it("wires the zen/go OpenAI listing endpoint", () => {
    const config = PROVIDER_MODELS_CONFIG["opencode-go"] as { url?: string; method?: string };
    expect(config).toBeTruthy();
    expect(config.url).toBe("https://opencode.ai/zen/go/v1/models");
  });

  it("lists the live catalogue instead of refusing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(listing), { status: 200 }),
    );

    const result = await listConnectionModels({
      id: "conn-1",
      provider: "opencode-go",
      apiKey: "opencode-key",
      providerSpecificData: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.models?.map((m) => (m as { id: string }).id)).toEqual(["kimi-k3", "glm-5.3", "qwen3.8-max"]);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.spyOn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://opencode.ai/zen/go/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer opencode-key");
  });

  it("keeps the per-model endpoint guard after the static catalogue is gone", () => {
    // supportedFormats lives in modelOverrides now (dynamic catalogue rule);
    // the sourceFormat-matched transport guard must keep seeing it.
    expect(getModelSupportedFormats("opencode-go", "kimi-k2.7-code")).toEqual(["openai"]);
    expect(getModelSupportedFormats("opencode-go", "deepseek-v4-pro")).toEqual(["openai", "claude", "openai-responses"]);
    // Probes need some model id even without a shipped catalogue.
    expect(getDefaultModel("opencode-go")).toBe("glm-5.2");
  });
});
