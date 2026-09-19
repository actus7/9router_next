import { describe, expect, it } from "vitest";

import REGISTRY from "@/server/llm-gateway/engine/providers/registry/index";
import { PROVIDER_MODELS_CONFIG } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsConfig";

type Entry = Record<string, unknown>;

const entries = REGISTRY as Entry[];

/** A provider the gateway can ask for its catalogue, by any of the three routes. */
function hasModelListing(entry: Entry): boolean {
  const id = String(entry.id);
  if (PROVIDER_MODELS_CONFIG[id]) return true;
  if (entry.modelsFetcher) return true;
  const transport = entry.transport as Record<string, unknown> | undefined;
  return Boolean(transport?.modelsFetcher);
}

function staticModelCount(entry: Entry): number {
  return Array.isArray(entry.models) ? entry.models.length : 0;
}

/**
 * The rule: a shipped model list is what you fall back on when you cannot ask.
 *
 * Every provider that answers a models endpoint must get its catalogue from
 * that endpoint, not from an array in this repository. A hardcoded list next to
 * a live one goes stale silently — Kilo Gateway shipped 6 models while the
 * endpoint returned 381, and the dashboard showed the 6.
 *
 * Providers with no listing endpoint keep their array: it is the only catalogue
 * they have. `modelOverrides` is how a provider carries per-model transport
 * metadata (upstream id, target format, quota family) that no `/models`
 * response contains, without carrying a catalogue.
 */
describe("dynamic model catalogue", () => {
  it("ships no static models for a provider that has a listing endpoint", () => {
    const offenders = entries
      .filter((entry) => hasModelListing(entry) && staticModelCount(entry) > 0)
      .map((entry) => `${entry.id} (${staticModelCount(entry)} models)`);

    expect(offenders).toEqual([]);
  });

  it("keeps the array for providers that cannot be asked", () => {
    // Otherwise the rule above would be trivially satisfiable by deleting every
    // catalogue in the repository, leaving those providers with no models at all.
    const shipped = entries.filter((entry) => !hasModelListing(entry) && staticModelCount(entry) > 0);
    expect(shipped.length).toBeGreaterThan(100);
  });

  it("only lets a provider without a catalogue carry model overrides", () => {
    const both = entries
      .filter((entry) => entry.modelOverrides && staticModelCount(entry) > 0)
      .map((entry) => String(entry.id));

    expect(both).toEqual([]);
  });
});
