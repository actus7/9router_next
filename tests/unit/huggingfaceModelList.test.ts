import { describe, expect, it } from "vitest";

import REGISTRY from "@/server/llm-gateway/engine/providers/registry/index";

type Entry = Record<string, unknown>;
type Model = { id: string; kind?: string };

/**
 * Ids the hf-inference route serves, as the Hub API reports them with
 * `inferenceProviderMapping` (checked 2026-10-31). The Hub is the source of
 * truth for this list, not the provider's docs: an id listed here without
 * hf-inference behind it answers the request with an error, not a model.
 */
const HF_INFERENCE_SERVED = new Set([
  "stabilityai/stable-diffusion-3-medium-diffusers",
  "openai/whisper-large-v3",
]);

const huggingface = (REGISTRY as Entry[]).find((entry) => entry.id === "huggingface");
const models = (huggingface?.models ?? []) as Model[];

describe("huggingface model list", () => {
  it("lists only models that the hf-inference route serves", () => {
    const unserved = models.map((model) => model.id).filter((id) => !HF_INFERENCE_SERVED.has(id));
    expect(unserved).toEqual([]);
  });

  it("keeps every served model that the registry should expose", () => {
    const listed = new Set(models.map((model) => model.id));
    for (const id of HF_INFERENCE_SERVED) {
      expect(listed.has(id)).toBe(true);
    }
  });
});
