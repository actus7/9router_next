import { describe, expect, it } from "vitest";

import { dropPaidModelsOfFreeTierProvider } from "@/server/application/use-cases/http/providers/[id]/models/freeTierCatalog";

/**
 * Kilo Gateway is a `freeTier` provider: the account pays nothing, and the
 * connection is there to identify you. Its `/models` endpoint, however, lists
 * the whole marketplace — 381 models, of which 349 are paid. Discovery used to
 * store all of them, so the picker filled with models that answer
 * `402 Paid Model - Credits Required`, and a batch test disabled 357 of them.
 *
 * The catalogue says which is which (`isFree`, and a zeroed `pricing`), so the
 * ones the account cannot use are dropped on the way in.
 */
const kiloPayload = [
  { id: "poolside/laguna-s-2.1:free", isFree: true, pricing: { prompt: "0", completion: "0" } },
  { id: "openrouter/free", pricing: { prompt: "0", completion: "0" } },
  { id: "google/gemini-3-pro-image", isFree: false, pricing: { prompt: "0.000002", completion: "0.000012" } },
  { id: "openai/gpt-5.4-image-2", pricing: { prompt: "0.0000025", completion: "0.00001" } },
  { id: "kilo-auto/free", isFree: true },
  // As duas formas de a Kilo dizer "pago" sem declarar um preço positivo: um
  // roteador cobra o que o modelo escolhido custar (`-1`), e outros trazem
  // preço zero mas exigem créditos. `isFree: false` é a resposta dela.
  { id: "kilo-auto/efficient", isFree: false, pricing: { prompt: "-1", completion: "-1" } },
  { id: "google/lyria-3-pro-preview", isFree: false, pricing: { prompt: "0", completion: "0" } },
];

describe("dropPaidModelsOfFreeTierProvider", () => {
  it("keeps only what a free-tier account can actually call", () => {
    const kept = dropPaidModelsOfFreeTierProvider("kilo-gateway", kiloPayload).map((m) => (m as { id: string }).id);

    expect(kept).toEqual(["poolside/laguna-s-2.1:free", "openrouter/free", "kilo-auto/free"]);
  });

  it("leaves a paid provider's catalogue alone", () => {
    // OpenAI is `apikey`: every model is billed, and dropping them would empty
    // the provider. The rule is about a provider that promises free use.
    expect(dropPaidModelsOfFreeTierProvider("openai", kiloPayload)).toHaveLength(kiloPayload.length);
  });

  it("does not empty a free-tier provider that prices everything", () => {
    // Better a catalogue with paid models in it than a provider that vanished:
    // the account may have credits, and an empty list explains nothing.
    const allPaid = kiloPayload.filter((m) => m.id.includes("image") || m.id.includes("gpt-5.4"));

    expect(dropPaidModelsOfFreeTierProvider("kilo-gateway", allPaid)).toEqual(allPaid);
  });

  it("treats a model that says nothing about price as free", () => {
    // Most providers do not report pricing at all. Absence of a price is not
    // evidence of one, and guessing would silently hide working models.
    const noPricing = [{ id: "a" }, { id: "b", name: "B" }];

    expect(dropPaidModelsOfFreeTierProvider("kilo-gateway", noPricing)).toEqual(noPricing);
  });
});
