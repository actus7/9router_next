import { beforeEach, describe, expect, it, vi } from "vitest";

import { withTenant } from "@/lib/db/tenant";

/**
 * The composed plugin tree is per-account state that lived in a module-level
 * `let`. `listPluginRows()` filters by tenant, so the query was never the
 * problem — the destination was: whoever wrote last published their tree to the
 * whole process, and every later reader got it.
 *
 * `src/server/harness/skills/context.ts` documents having fixed exactly this
 * for skills. This is the same guarantee for plugins.
 */

const rowsByTenant = vi.hoisted(() => new Map<string, unknown[]>());
const currentTenant = vi.hoisted(() => ({ id: "" }));

vi.mock("@/lib/db/repos/pluginRowsRepo", () => ({
  listPluginRows: vi.fn(async () => rowsByTenant.get(currentTenant.id) ?? []),
  getPluginTreeRevision: vi.fn(async () => (rowsByTenant.get(currentTenant.id) ?? []).length),
  upsertPluginRow: vi.fn(async () => undefined),
  deletePluginRow: vi.fn(async () => undefined),
}));

import { bootstrap, getPluginTreeState, reloadPluginTree } from "@/server/plugin-core/context";
import { HARNESS_PLUGINS } from "@/shared/harness/agentPlugins";

/**
 * A stored row that turns a bundled capability off for one account, shaped the
 * way the UI stores it — the whole capability config, which the factory
 * validates, and `enabled: false`.
 */
function disabled(id: string) {
  const plugin = HARNESS_PLUGINS.find((candidate) => candidate.id === id);
  if (!plugin) throw new Error(`no bundled capability named ${id}`);
  return {
    id,
    plugin: "harness-capability",
    config: plugin as unknown as Record<string, unknown>,
    position: 0,
    enabled: false,
    source: "user" as const,
  };
}

function hasRow(rows: ReadonlyArray<{ id: string }>, id: string): boolean {
  return rows.some((row) => row.id === id);
}

/** Runs `fn` as `tenantId`, for both the ALS and the mocked repo. */
async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  currentTenant.id = tenantId;
  return withTenant(tenantId, fn);
}

beforeEach(() => {
  rowsByTenant.clear();
  currentTenant.id = "";
});

describe("plugin tree is per account", () => {
  it("does not serve one account's composed rows to another", async () => {
    const ctx = await bootstrap();

    // Account A disables a capability, which drops it from A's tree.
    rowsByTenant.set("account-a", [disabled("tool-memory")]);
    const a = await asTenant("account-a", () => reloadPluginTree(ctx));
    expect(hasRow(a.rows, "tool-memory")).toBe(false);

    // Account B has never stored anything: it must see the bundle defaults.
    const b = await asTenant("account-b", async () => getPluginTreeState());
    expect(hasRow(b.rows, "tool-memory")).toBe(true);
    expect(b.revision).toBe(0);
  });

  it("gives an account back its own tree after another one recomposes", async () => {
    const ctx = await bootstrap();
    rowsByTenant.set("account-a", [disabled("tool-memory")]);

    await asTenant("account-a", () => reloadPluginTree(ctx));
    await asTenant("account-b", () => reloadPluginTree(ctx));
    const a = await asTenant("account-a", async () => getPluginTreeState());

    expect(hasRow(a.rows, "tool-memory")).toBe(false);
  });
});
