import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({
  proxyAwareFetch,
}));

import { resolveKimchiModels } from "@/server/llm-gateway/engine/services/kimchiModels";

describe("resolveKimchiModels", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("keeps a text-and-image model in the LLM catalog with vision capability", async () => {
    proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      models: [{
        slug: "vision-chat",
        display_name: "Vision Chat",
        input_modalities: ["text", "image"],
      }],
    }), { status: 200 }));

    const result = await resolveKimchiModels({ accessToken: "test-token" }, { forceRefresh: true });

    expect(result?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "vision-chat",
        kind: "llm",
        type: "llm",
        capabilities: expect.objectContaining({ vision: true }),
      }),
    ]));
  });

  it("keeps an image-only model outside the chat LLM catalog", async () => {
    proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      models: [{ slug: "image-reader", input_modalities: ["image"] }],
    }), { status: 200 }));

    const result = await resolveKimchiModels({ accessToken: "test-token" }, { forceRefresh: true });

    expect(result?.models[0]).toMatchObject({ id: "image-reader", kind: "imageToText", type: "imageToText" });
  });
});
