import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A model the provider stopped listing is gone from every place that names it,
 * in the same transaction that drops it from the catalogue: combos (list,
 * lanes, lane entries, classifier), aliases, the disabled list, access
 * policies and the capacity adapter. Left behind, a plain combo kept paying a
 * 404 per account every two minutes and a smart combo kept a pin that matched
 * nothing.
 */

type Row = Record<string, unknown>;
const tables = vi.hoisted(() => ({
  kv: [] as Array<{ scope: string; key: string; value: string }>,
  combos: [] as Array<{ id: string; models: string; routing: string | null }>,
  accessPolicies: [] as Array<{ subjectType: string; subjectId: string; policy: string }>,
  settings: [] as Array<{ data: string }>,
  activeConnections: 1,
}));

const run = vi.hoisted(() => vi.fn(async (sql: string, params: unknown[] = []) => {
  if (sql.startsWith("DELETE FROM kv")) {
    const [, scope, ...rest] = params as string[];
    const keys = sql.includes(" IN (") ? rest : [rest[0]];
    const realScope = sql.includes("scope = 'customModels'") ? "customModels" : scope;
    const realKeys = sql.includes("scope = 'customModels'") ? [scope, ...rest] : keys;
    tables.kv = tables.kv.filter((r) => !(r.scope === realScope && realKeys.includes(r.key)));
  } else if (sql.startsWith("INSERT INTO kv") && sql.includes("'customModels'")) {
    const values = (params as string[]);
    for (let i = 0; i < values.length; i += 3) {
      tables.kv = tables.kv.filter((r) => !(r.scope === "customModels" && r.key === values[i + 1]));
      tables.kv.push({ scope: "customModels", key: values[i + 1], value: values[i + 2] });
    }
  } else if (sql.startsWith("INSERT INTO kv")) {
    const [, scope, key, value] = params as string[];
    tables.kv = tables.kv.filter((r) => !(r.scope === scope && r.key === key));
    tables.kv.push({ scope, key, value });
  } else if (sql.startsWith("UPDATE combos")) {
    const [models, routing, , , id] = params as string[];
    const row = tables.combos.find((r) => r.id === id)!;
    row.models = models;
    row.routing = routing;
  } else if (sql.startsWith("UPDATE accessPolicies")) {
    const [policy, , , subjectType, subjectId] = params as string[];
    tables.accessPolicies.find((r) => r.subjectType === subjectType && r.subjectId === subjectId)!.policy = policy;
  } else if (sql.startsWith("UPDATE settings")) {
    tables.settings[0].data = (params as string[])[0];
  }
  return { changes: 1 };
}));

const all = vi.hoisted(() => vi.fn(async (sql: string, params: unknown[] = []): Promise<Row[]> => {
  if (sql.includes("FROM kv")) {
    const scope = sql.includes("'customModels'") ? "customModels" : (params as string[])[1];
    return tables.kv.filter((r) => r.scope === scope).map((r) => ({ key: r.key, value: r.value }));
  }
  if (sql.includes("FROM combos")) return tables.combos.map((r) => ({ ...r }));
  if (sql.includes("FROM accessPolicies")) return tables.accessPolicies.map((r) => ({ ...r }));
  return [];
}));

const get = vi.hoisted(() => vi.fn(async (sql: string) => {
  if (sql.includes("FROM settings")) return tables.settings[0];
  if (sql.includes("FROM providerConnections")) return { n: tables.activeConnections };
  return undefined;
}));
const transaction = vi.hoisted(() => vi.fn(async (fn: () => Promise<unknown>) => fn()));

vi.mock("@/lib/db/driver", () => ({ getAdapter: vi.fn(async () => ({ run, all, get, transaction })) }));
vi.mock("@/lib/db/tenant", () => ({ currentTenantId: () => "t1", currentActorUserId: () => "u1", tryCurrentTenantContext: () => null }));

import { deleteCustomModel, syncDiscoveredCustomModels } from "@/lib/db/repos/aliasRepo";
import { pruneComboReferences } from "@/lib/db/repos/modelReferencesRepo";

const discovered = (id: string) => ({
  scope: "customModels",
  key: `kgw|${id}|llm`,
  value: JSON.stringify({ providerAlias: "kgw", id, type: "llm", source: "discovered" }),
});

describe("pruneComboReferences", () => {
  const dead = new Set(["kgw/old-model"]);

  it("drops a dead model from the list, the lanes and the classifier, keeping lane entries aligned", () => {
    const next = pruneComboReferences({
      models: ["kgw/old-model", "cx/gpt-5.6-sol"],
      routing: {
        classifier: { enabled: true, model: "KGW/Old-Model" },
        overrides: { general: { complex: ["cx/gpt-5.6-sol", "kgw/old-model", "kgw/live"] } },
        entries: { general: { complex: [{ connectionId: "a" }, { connectionId: "b" }, null] } },
      },
    }, dead);

    expect(next).toEqual({
      models: ["cx/gpt-5.6-sol"],
      routing: {
        classifier: { enabled: false, model: "auto" },
        overrides: { general: { complex: ["cx/gpt-5.6-sol", "kgw/live"] } },
        entries: { general: { complex: [{ connectionId: "a" }, null] } },
      },
    });
  });

  it("returns null when the combo does not name a dead model", () => {
    expect(pruneComboReferences({ models: ["cx/gpt-5.6-sol"], routing: null }, dead)).toBeNull();
  });
});

describe("syncDiscoveredCustomModels removes a dropped model from every reference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.kv = [
      discovered("old-model"),
      discovered("live"),
      { scope: "modelAliases", key: "fast", value: JSON.stringify("kgw/old-model") },
      { scope: "modelAliases", key: "keep", value: JSON.stringify("kgw/live") },
      { scope: "disabledModels", key: "kgw", value: JSON.stringify(["old-model", "live"]) },
    ];
    tables.combos = [
      { id: "c1", models: JSON.stringify(["kgw/old-model", "kgw/live"]), routing: null },
      { id: "c2", models: JSON.stringify(["cx/gpt-5.6-sol"]), routing: null },
    ];
    tables.accessPolicies = [
      { subjectType: "key", subjectId: "k1", policy: JSON.stringify({ models: ["kgw/old-model", "kgw/*"] }) },
    ];
    tables.settings = [{ data: JSON.stringify({ capacityAdapter: { vision: { enabled: true, models: ["kgw/old-model"] } } }) }];
    tables.activeConnections = 1;
  });

  it("prunes combos, aliases, disabled ids, policies and the capacity adapter in the catalogue's transaction", async () => {
    await syncDiscoveredCustomModels("kgw", [{ providerAlias: "kgw", id: "live" }]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(JSON.parse(tables.combos[0].models)).toEqual(["kgw/live"]);
    expect(run.mock.calls.some(([sql, params]) => sql.startsWith("UPDATE combos") && (params as string[]).includes("c2"))).toBe(false);
    expect(tables.kv.find((r) => r.scope === "modelAliases" && r.key === "fast")).toBeUndefined();
    expect(tables.kv.find((r) => r.scope === "modelAliases" && r.key === "keep")).toBeDefined();
    expect(JSON.parse(tables.kv.find((r) => r.scope === "disabledModels")!.value)).toEqual(["live"]);
    expect(JSON.parse(tables.accessPolicies[0].policy).models).toEqual(["kgw/*"]);
    expect(JSON.parse(tables.settings[0].data).capacityAdapter.vision).toEqual({ enabled: false, models: [] });
  });

  it("drops combo entries that name an alias of a dead model", async () => {
    tables.combos[1].models = JSON.stringify(["fast", "cx/gpt-5.6-sol"]);

    await syncDiscoveredCustomModels("kgw", [{ providerAlias: "kgw", id: "live" }]);

    expect(JSON.parse(tables.combos[1].models)).toEqual(["cx/gpt-5.6-sol"]);
  });

  it("does not call a model dead while another spelling of its id is still listed", async () => {
    tables.kv = [
      { scope: "customModels", key: "kgw|Foo|llm", value: JSON.stringify({ providerAlias: "kgw", id: "Foo", type: "llm", source: "discovered" }) },
    ];
    tables.combos = [{ id: "c1", models: JSON.stringify(["kgw/foo"]), routing: null }];

    await syncDiscoveredCustomModels("kgw", [{ providerAlias: "kgw", id: "foo" }]);

    expect(JSON.parse(tables.combos[0].models)).toEqual(["kgw/foo"]);
  });

  it("reconciles the catalogue but keeps references when another connection may still list the model", async () => {
    tables.activeConnections = 2;

    await syncDiscoveredCustomModels("kgw", [{ providerAlias: "kgw", id: "live" }]);

    expect(tables.kv.find((r) => r.scope === "customModels" && r.key === "kgw|old-model|llm")).toBeUndefined();
    expect(JSON.parse(tables.combos[0].models)).toEqual(["kgw/old-model", "kgw/live"]);
  });

  it("prunes references when the operator deletes a model no other entry carries", async () => {
    await deleteCustomModel({ providerAlias: "kgw", id: "old-model" });

    expect(tables.kv.find((r) => r.scope === "customModels" && r.key === "kgw|old-model|llm")).toBeUndefined();
    expect(JSON.parse(tables.combos[0].models)).toEqual(["kgw/live"]);
  });

  it("keeps references to a model still served by a manual entry", async () => {
    tables.kv.push({ scope: "customModels", key: "kgw|old-model|image", value: JSON.stringify({ providerAlias: "kgw", id: "old-model", source: "manual" }) });

    await syncDiscoveredCustomModels("kgw", [{ providerAlias: "kgw", id: "live" }]);

    expect(JSON.parse(tables.combos[0].models)).toEqual(["kgw/old-model", "kgw/live"]);
  });

  it("refuses an empty listing instead of wiping the catalogue and every combo", async () => {
    await expect(syncDiscoveredCustomModels("kgw", [])).rejects.toThrow(/empty model listing/);

    expect(transaction).not.toHaveBeenCalled();
    expect(JSON.parse(tables.combos[0].models)).toEqual(["kgw/old-model", "kgw/live"]);
  });
});
