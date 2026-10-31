import { describe, expect, it } from "vitest";

import { parsePollinationsModels } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsParsers";

/**
 * `gen.pollinations.ai/v1/models` lists text and image models in one array,
 * told apart by `category`. Discovery stores what it gets as chat models, so an
 * image model left in would be offered in the chat picker and fail there.
 */
describe("pollinations model listing", () => {
  it("keeps text models and drops the rest", () => {
    const models = parsePollinationsModels({
      data: [
        { id: "openai/gpt-5.4-nano", category: "text", title: "GPT-5.4 Nano" },
        { id: "flux", category: "image" },
        { id: "untagged" },
      ],
    });

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-5.4-nano", "untagged"]);
    expect(models[0].name).toBe("GPT-5.4 Nano");
  });
});
