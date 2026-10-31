import { describe, expect, it } from "vitest";

const { default: huggingfaceImage } = await import("@/server/llm-gateway/engine/handlers/imageProviders/huggingface");

const MODEL = "black-forest-labs/FLUX.1-schnell";

describe("huggingface image endpoint", () => {
  it("builds the model URL on the router hf-inference path", () => {
    expect(huggingfaceImage.buildUrl(MODEL)).toBe(`https://router.huggingface.co/hf-inference/models/${MODEL}`);
  });

  it("does not point at the retired api-inference.huggingface.co host", () => {
    expect(huggingfaceImage.buildUrl(MODEL)).not.toContain("api-inference.huggingface.co");
  });
});
