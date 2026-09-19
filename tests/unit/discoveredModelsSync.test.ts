import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const all = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => [] as Array<Record<string, unknown>>));
const transaction = vi.hoisted(() => vi.fn(async (fn: () => Promise<unknown>) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, all, transaction })),
}));

import { syncDiscoveredCustomModels } from "@/lib/db/repos/aliasRepo";

/**
 * A model refresh writes the provider's whole catalogue. Kilo Gateway returns
 * 381 models and OpenRouter more, and one statement per model means that many
 * sequential Neon round-trips — measured at ~180ms each, so over a minute with
 * the transaction held open and the Refresh button spinning. It reads as a
 * hang, which is exactly how it was reported.
 *
 * The write has to be batched, so the cost of a refresh is the size of the
 * catalogue in rows, not in round-trips.
 */
describe("syncDiscoveredCustomModels", () => {
  const catalogue = Array.from({ length: 381 }, (_, i) => ({
    providerAlias: "kgw",
    id: `vendor/model-${i}`,
    name: `Model ${i}`,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    all.mockResolvedValue([]);
  });

  it("writes a 381-model catalogue in a handful of statements", async () => {
    await syncDiscoveredCustomModels("kgw", catalogue);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("still writes every model exactly once", async () => {
    await syncDiscoveredCustomModels("kgw", catalogue);

    const written = run.mock.calls.flatMap(([, params]) => (params ?? []).filter(
      (param): param is string => typeof param === "string" && param.startsWith("kgw|vendor/model-"),
    ));
    expect(new Set(written).size).toBe(381);
  });

  it("drops the models that left the catalogue, and only those", async () => {
    all.mockResolvedValue([
      { key: "kgw|vendor/model-0|llm", value: JSON.stringify({ providerAlias: "kgw", type: "llm", source: "discovered" }) },
      { key: "kgw|vendor/gone|llm", value: JSON.stringify({ providerAlias: "kgw", type: "llm", source: "discovered" }) },
      { key: "kgw|vendor/typed-in|llm", value: JSON.stringify({ providerAlias: "kgw", type: "llm", source: "manual" }) },
      { key: "other|vendor/gone|llm", value: JSON.stringify({ providerAlias: "other", type: "llm", source: "discovered" }) },
    ]);

    await syncDiscoveredCustomModels("kgw", catalogue);

    const deletes = run.mock.calls.filter(([sql]) => String(sql).includes("DELETE"));
    const deleted = deletes.flatMap(([, params]) => (params ?? []).slice(1));
    expect(deleted).toEqual(["kgw|vendor/gone|llm"]);
  });

  it("leaves a manually curated entry alone", async () => {
    all.mockResolvedValue([
      { key: "kgw|vendor/model-1|llm", value: JSON.stringify({ providerAlias: "kgw", type: "llm", source: "manual", name: "Mine" }) },
    ]);

    await syncDiscoveredCustomModels("kgw", [{ providerAlias: "kgw", id: "vendor/model-1", name: "Upstream" }]);

    const written = run.mock.calls.flatMap(([, params]) => (params ?? []));
    expect(written).not.toContain("kgw|vendor/model-1|llm");
  });
});
