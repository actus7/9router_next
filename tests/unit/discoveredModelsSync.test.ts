import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const all = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => [] as Array<Record<string, unknown>>));
const transaction = vi.hoisted(() => vi.fn(async (fn: () => Promise<unknown>) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, all, transaction })),
}));

import { discoveredModelKind, syncDiscoveredCustomModels } from "@/lib/db/repos/aliasRepo";

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

  // The Vercel AI Gateway tags each model; storing them all as "llm" left its
  // image models out of `generate_image`'s candidate list.
  it("stores each model under the kind the provider reported", async () => {
    await syncDiscoveredCustomModels("vercel", [
      { providerAlias: "vercel", id: "openai/gpt-5", type: "llm" },
      { providerAlias: "vercel", id: "bfl/flux-2-pro", type: "image" },
    ]);

    const written = run.mock.calls.flatMap(([, params]) => (params ?? []));
    expect(written).toContain("vercel|openai/gpt-5|llm");
    expect(written).toContain("vercel|bfl/flux-2-pro|image");
    const imageRow = written.find((param) => typeof param === "string" && param.includes('"id":"bfl/flux-2-pro"'));
    expect(JSON.parse(String(imageRow)).type).toBe("image");
  });

  it("replaces a model's old chat-kind row when discovery now says image", async () => {
    all.mockResolvedValue([
      { key: "vercel|bfl/flux-2-pro|llm", value: JSON.stringify({ providerAlias: "vercel", type: "llm", source: "discovered" }) },
    ]);

    await syncDiscoveredCustomModels("vercel", [{ providerAlias: "vercel", id: "bfl/flux-2-pro", type: "image" }]);

    const deleted = run.mock.calls.filter(([sql]) => String(sql).includes("DELETE")).flatMap(([, params]) => (params ?? []).slice(1));
    expect(deleted).toEqual(["vercel|bfl/flux-2-pro|llm"]);
  });
});

describe("discoveredModelKind", () => {
  it.each([
    [{ type: "language" }, "llm"],
    [{ type: "image" }, "image"],
    [{ type: "video" }, "video"],
    [{ type: "speech" }, "tts"],
    [{ type: "transcription" }, "stt"],
    [{ type: "embedding" }, "embedding"],
    [{ kind: "imageToText" }, "imageToText"],
    [{}, "llm"],
    [{ type: "something-new" }, "llm"],
    // untagged listings (Gemini) keep the name-based guess
    [{ id: "gemini-3.1-flash-image" }, "image"],
    [{ id: "text-embedding-004" }, "embedding"],
    // a provider's tag beats the guess: Vercel calls this one a language model
    [{ id: "google/gemini-3.1-flash-image", type: "language" }, "llm"],
  ])("maps %o to %s", (entry, kind) => {
    expect(discoveredModelKind(entry)).toBe(kind);
  });

  it.each(["reranking", "realtime", "evaluation"])("drops %s models, which no endpoint serves", (type) => {
    expect(discoveredModelKind({ type })).toBeNull();
  });
});
