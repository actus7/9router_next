import { describe, expect, it } from "vitest";

import codexImage from "@/server/llm-gateway/engine/handlers/imageProviders/codex";

// The hosted image_generation tool call runs on a fixed main model. Deriving it from the
// image id sent retired gpt-5.5 / gpt-5.6-* hosts to Codex, which rejects them.

describe("codex image generation hosts image_generation on gpt-6-sol", () => {
  it.each(["gpt-5.5-image", "gpt-5.6-sol-image", "gpt-5.3-image", "gpt-6-sol-image"])(
    "%s is driven by gpt-6-sol",
    (model) => {
      const body = codexImage.buildBody(model, { prompt: "a cat" });

      expect(body.model).toBe("gpt-6-sol");
    }
  );
});
