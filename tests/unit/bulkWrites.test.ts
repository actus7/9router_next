import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const all = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => [] as Array<Record<string, unknown>>));
const get = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => undefined as Record<string, unknown> | undefined));
const transaction = vi.hoisted(() => vi.fn(async (fn: () => Promise<unknown>) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, all, get, transaction })),
}));

import { deleteCustomModelsByProvider, deleteModelAliasesByProvider } from "@/lib/db/repos/aliasRepo";
import { setProviderConnectionsActive } from "@/lib/db/repos/connectionsRepo";
import { deleteProxyPools, setProxyPoolsActive } from "@/lib/db/repos/proxyPoolsRepo";
import { deleteSmartModelProfiles, upsertSmartModelProfiles } from "@/lib/db/repos/smartModelProfilesRepo";
import { makeKv } from "@/lib/db/helpers/kvStore";

/**
 * Every write here takes a list, and every one of them used to walk it one row
 * at a time. Against Neon a statement is a network round-trip (~180ms), so a
 * list of 60 was a minute of held transaction for a single click — which is how
 * "Disable all" and "Clear All Models" came to look like the app had hung.
 *
 * These assertions are on the *number of statements*, not on the result: the
 * result was always right, and that is exactly why the cost stayed invisible.
 */
const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);

beforeEach(() => {
  vi.clearAllMocks();
  all.mockResolvedValue([]);
  get.mockResolvedValue(undefined);
});

describe("bulk writes take one statement per batch", () => {
  it("activates many connections at once", async () => {
    await setProviderConnectionsActive(ids, false);

    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0]![0])).toMatch(/UPDATE providerConnections/);
    expect(run.mock.calls[0]![1]).toEqual([0, expect.any(String), "test-user", ...ids]);
  });

  it("activates many proxy pools at once", async () => {
    await setProxyPoolsActive(ids, true);

    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0]![0])).toMatch(/UPDATE proxyPools/);
  });

  it("deletes the unbound proxy pools in one statement and reports the bound ones", async () => {
    const result = await deleteProxyPools(ids, (poolId) => poolId === "id-7");

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.blocked).toEqual(["id-7"]);
    expect(result.deleted).toHaveLength(59);
    expect(result.deleted).not.toContain("id-7");
  });

  it("clears a provider's custom models without a request per model", async () => {
    all.mockResolvedValue(ids.map((id) => ({
      key: `kgw|${id}|llm`,
      value: JSON.stringify({ providerAlias: "kgw", type: "llm", source: "discovered" }),
    })));

    const deleted = await deleteCustomModelsByProvider("kgw");

    expect(run).toHaveBeenCalledTimes(1);
    expect(deleted).toBe(1);
  });

  it("leaves another provider's models alone while clearing one", async () => {
    all.mockResolvedValue([
      { key: "kgw|a|llm", value: JSON.stringify({ providerAlias: "kgw", type: "llm" }) },
      { key: "openai|b|llm", value: JSON.stringify({ providerAlias: "openai", type: "llm" }) },
    ]);

    await deleteCustomModelsByProvider("kgw");

    expect(run.mock.calls[0]![1]).toEqual(["test-user", "kgw|a|llm"]);
  });

  it("clears a provider's aliases in one statement", async () => {
    all.mockResolvedValue([
      { key: "fast", value: JSON.stringify("kgw/model-a") },
      { key: "smart", value: JSON.stringify("openai/gpt-5") },
    ]);

    await deleteModelAliasesByProvider("kgw");

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1]).toEqual(["test-user", "fast"]);
  });

  it("deletes many smart model profiles in one statement", async () => {
    await deleteSmartModelProfiles(ids);

    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0]![0])).toMatch(/DELETE FROM smartModelProfiles/);
  });

  /**
   * This one was two round-trips per profile — a SELECT for `createdAt` and an
   * INSERT — and the caller hands it the whole inventory.
   */
  it("upserts many smart model profiles with one read and one write", async () => {
    const profiles = ids.map((id) => ({
      modelKey: id,
      inventoryFingerprint: "fp",
      source: "heuristic",
      sources: [],
    })) as unknown as Parameters<typeof upsertSmartModelProfiles>[0];

    await upsertSmartModelProfiles(profiles);

    expect(all).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("writes many kv entries in one statement", async () => {
    await makeKv("settings").setMany(Object.fromEntries(ids.map((id) => [id, { on: true }])));

    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0]![0])).toMatch(/INSERT INTO kv/);
  });
});
