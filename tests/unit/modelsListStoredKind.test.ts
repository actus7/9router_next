import { describe, expect, it } from "vitest";

import { collectMergedModelIds } from "@/server/application/use-cases/http/v1/models/modelsListBuilders";
import { buildProviderModelEntries } from "@/server/application/use-cases/http/v1/models/modelsListProviderEntries";

// Discovery now stores each model's kind. The same id also arrives from the
// provider's live listing, and it has to be listed under the stored kind — not
// guessed from its name, which put Vercel's image models in the chat list and
// Gemini's untyped ones out of the image list.
const ctx = {
  providerId: "vercel-ai-gateway",
  outputAlias: "vercel",
  staticAlias: "vercel",
  rawModelIds: ["bfl/flux-2-pro", "openai/gpt-5", "google/gemini-3.1-flash-image"],
  staticModelKindById: new Map<string, string>(),
  liveModelKindById: new Map<string, string>(),
  liveCapabilitiesById: new Map<string, Record<string, unknown>>(),
};
const stored = [
  { providerAlias: "vercel", id: "bfl/flux-2-pro", type: "image" },
  { providerAlias: "vercel", id: "openai/gpt-5", type: "llm" },
  { providerAlias: "vercel", id: "google/gemini-3.1-flash-image", type: "llm" },
];

function listed(kind: string): string[] {
  const { mergedModelIds, customModelKindById } = collectMergedModelIds(ctx, stored, {}, [kind]);
  return buildProviderModelEntries(ctx, mergedModelIds, customModelKindById, [kind], () => false).map((m) => String(m.id));
}

describe("model list honours the stored kind", () => {
  it("keeps an image model out of the chat list even when the live listing names it", () => {
    expect(listed("llm")).toEqual(["vercel/openai/gpt-5", "vercel/google/gemini-3.1-flash-image"]);
  });

  it("lists it under image, and a model the provider called language is not an image model", () => {
    expect(listed("image")).toEqual(["vercel/bfl/flux-2-pro"]);
  });
});
