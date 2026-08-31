import {
  AI_PROVIDERS,
  getProviderAvailability,
  getProviderConnectionAuthTypes,
  resolveProviderId,
  validateProviderCatalog,
  type ProviderCatalogEntry,
} from "@/shared/constants/providers";
import { describe, expect, it } from "vitest";

describe("provider catalog projection", () => {
  it("keeps aliases resolvable and validates the shipped registry", () => {
    expect(validateProviderCatalog()).toEqual([]);
    expect(resolveProviderId("naga")).toBe("naga-ac");
    expect(resolveProviderId("openrouter")).toBe("openrouter");
  });

  it("derives availability and connection auth from one typed provider entry", () => {
    const naga = AI_PROVIDERS["naga-ac"] as ProviderCatalogEntry;
    const openRouter = AI_PROVIDERS.openrouter as ProviderCatalogEntry;

    expect(getProviderAvailability(naga)).toBe("freeTier");
    expect(getProviderConnectionAuthTypes(naga)).toEqual(["oauth", "apikey", "api_key"]);
    expect(getProviderAvailability(openRouter)).toBe("freeTier");
    expect(getProviderConnectionAuthTypes(openRouter)).toEqual(["apikey", "api_key"]);
  });

  it("reports invalid categories, aliases and incompatible auth declarations", () => {
    const invalid = [
      { id: "duplicate", alias: "same", category: "free" },
      { id: "duplicate", alias: "same", category: "invalid" },
      { id: "mixed", alias: "mixed", category: "free", noAuth: true, authModes: ["apikey"] },
    ];
    expect(validateProviderCatalog(invalid)).toEqual(expect.arrayContaining([
      "Duplicate provider id: duplicate",
      "Duplicate provider alias: same",
      "Provider duplicate has invalid category",
      "Provider mixed mixes noAuth with credential auth",
    ]));
  });
});
