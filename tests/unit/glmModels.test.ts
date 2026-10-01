import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsConfig";
import { listConnectionModels } from "@/server/application/use-cases/http/providers/[id]/models/listConnectionModels";
import { getDefaultModel, getModelSupportedFormats } from "@/server/llm-gateway/engine/config/providerModels";

/**
 * GLM Coding answers a standard OpenAI listing at /api/coding/paas/v4/models —
 * the detail page used to hit "Provider glm does not support models listing"
 * because no PROVIDER_MODELS_CONFIG entry existed.
 */
const listing = {
  object: "list",
  data: [
    { id: "glm-5.3", object: "model", created: 1790892687, owned_by: "zai" },
    { id: "glm-4.7", object: "model", created: 1790892687, owned_by: "zai" },
    { id: "glm-4.6v", object: "model", created: 1790892687, owned_by: "zai" },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("glm models listing", () => {
  it("wires the coding OpenAI listing endpoint", () => {
    const config = PROVIDER_MODELS_CONFIG["glm"] as { url?: string };
    expect(config).toBeTruthy();
    expect(config.url).toBe("https://api.z.ai/api/coding/paas/v4/models");
  });

  it("lists the live catalogue instead of refusing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(listing), { status: 200 }),
    );

    const result = await listConnectionModels({
      id: "conn-1",
      provider: "glm",
      apiKey: "zai-key",
      providerSpecificData: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.models?.map((m) => (m as { id: string }).id)).toEqual(["glm-5.3", "glm-4.7", "glm-4.6v"]);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.spyOn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z.ai/api/coding/paas/v4/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer zai-key");
  });

  it("keeps probes working without the static catalogue", () => {
    // The connection test needs some model id to send even when the catalogue
    // comes from discovery; modelOverrides is what names the known ones.
    expect(getDefaultModel("glm")).toBe("glm-5.3");
    expect(getModelSupportedFormats("glm", "glm-5.3")).toBeNull();
  });
});
