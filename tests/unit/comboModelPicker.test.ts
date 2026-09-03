import { describe, expect, it } from "vitest";
import { buildGroupedModels } from "@/shared/components/buildGroupedModels";
import { AI_PROVIDERS } from "@/shared/constants/providers";

function build(kindFilter: string | null, noAuthIds: string[], activeProviders: string[] = []) {
  return buildGroupedModels({
    filteredActiveProviders: activeProviders.map((provider) => ({ provider })),
    activeProviders: activeProviders.map((provider) => ({ provider })),
    modelAliases: {},
    allProviders: AI_PROVIDERS as unknown as Record<string, Record<string, unknown>>,
    providerNodes: [],
    customModels: [],
    disabledModels: {},
    kindFilter,
    cursorModels: [],
    PROVIDER_ORDER: [],
    NO_AUTH_PROVIDER_IDS: noAuthIds,
  });
}

describe("model picker provider eligibility", () => {
  // anysearch and context7 declare serviceKinds ["webSearch"] and list models
  // without a `kind`, so filtering by model kind alone let them pose as LLMs and
  // land in chat combos — where they answer with raw search results.
  it("hides search-only providers from a chat picker", () => {
    const groups = build(null, ["anysearch", "context7", "aihorde"]);
    expect(Object.keys(groups)).not.toContain("anysearch");
    expect(Object.keys(groups)).not.toContain("context7");
    expect(Object.keys(groups)).toContain("aihorde");
  });

  it("hides search-only providers even when they have an active connection", () => {
    const groups = build(null, [], ["anysearch", "groq"]);
    expect(Object.keys(groups)).not.toContain("anysearch");
    expect(Object.keys(groups)).toContain("groq");
  });

  it("still offers search providers to a web search picker", () => {
    const groups = build("webSearch", ["anysearch"]);
    expect(Object.keys(groups)).toContain("anysearch");
  });

  it("keeps chat providers that also do other services", () => {
    const groups = build(null, [], ["gemini", "perplexity"]);
    expect(Object.keys(groups)).toEqual(expect.arrayContaining(["gemini", "perplexity"]));
  });
});
