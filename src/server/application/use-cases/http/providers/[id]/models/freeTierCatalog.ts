import { AI_PROVIDERS } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";

/**
 * A model the account would be billed for.
 *
 * `isFree` is the provider's own answer, and it is taken both ways: Kilo's
 * routers say `isFree: false` while pricing `-1` (they cost whatever model
 * they pick), and some paid models declare a price of zero and still answer
 * `402 Credits Required`. Reading only the price let those through.
 *
 * Without `isFree`, any price other than zero counts — including `-1`, which
 * means "variable", not "free". A model that says nothing about price is
 * treated as free: most providers report no pricing at all, and guessing
 * "paid" would hide working models.
 */
function isPaidModel(model: unknown): boolean {
  if (!model || typeof model !== "object") return false;
  const entry = model as Record<string, unknown>;
  if (typeof entry.isFree === "boolean") return !entry.isFree;

  const pricing = entry.pricing as Record<string, unknown> | undefined;
  if (!pricing) return false;
  return Number(pricing.prompt || 0) !== 0 || Number(pricing.completion || 0) !== 0;
}

/**
 * Drops the models a free-tier provider lists but a free-tier account cannot call.
 *
 * Kilo Gateway is the case this exists for: it is `category: "freeTier"` — the
 * account pays nothing and the connection only identifies it — but its
 * `/models` endpoint lists the whole marketplace, 349 of 381 models being paid.
 * Storing those filled the picker with models that answer `402 Paid Model -
 * Credits Required`, and a batch test disabled 357 of them in one run.
 *
 * Only applies to `freeTier` providers: on an `apikey` provider every model is
 * billed, and this rule would empty the catalogue. It also refuses to empty a
 * free-tier catalogue that prices everything — the account may hold credits,
 * and a provider that vanished explains nothing.
 */
export function dropPaidModelsOfFreeTierProvider(providerId: string, models: unknown[]): unknown[] {
  const provider = AI_PROVIDERS[normalizeProviderId(providerId)];
  if (provider?.category !== "freeTier") return models;

  const free = models.filter((model) => !isPaidModel(model));
  return free.length > 0 ? free : models;
}
