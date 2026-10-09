import { beforeEach, describe, expect, it, vi } from "vitest";

// O caminho quente de uma requisição do gateway lia a chave, os modelos
// desabilitados, as settings e o combo do Neon a cada chamada, em série, antes
// do primeiro byte. Estes testes seguram o cache (por conta) e a invalidação.

const db = vi.hoisted(() => {
  const state = {
    keys: new Map<string, { id: string; userId: string; isActive: number; profile: string | null }>(),
    disabled: new Map<string, Record<string, string[]>>(),
    combos: new Map<string, Array<Record<string, unknown>>>(),
    settings: JSON.stringify({ requireApiKey: true }),
  };
  const keyRow = (userId: string, id: string) =>
    [...state.keys.entries()].find(([, v]) => v.userId === userId && v.id === id);
  const adapter = {
    get: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("WHERE key = ?")) return state.keys.get(String(params[0]));
      if (sql.includes("FROM apiKeys WHERE userId = ? AND id = ?")) {
        const hit = keyRow(String(params[0]), String(params[1]));
        return hit ? { id: hit[1].id, key: hit[0], name: null, machineId: null, isActive: hit[1].isActive, createdAt: "", sink: "manual", sinkRef: null, revokedAt: null } : undefined;
      }
      if (sql.includes("FROM settings")) return { data: state.settings };
      if (sql.includes("FROM combos WHERE userId = ? AND id = ?")) {
        return (state.combos.get(String(params[0])) ?? []).find((c) => c.id === params[1]);
      }
      if (sql.includes("FROM kv")) return undefined;
      return undefined;
    }),
    all: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM kv")) {
        const per = state.disabled.get(String(params[0])) ?? {};
        return Object.entries(per).map(([key, v]) => ({ key, value: JSON.stringify(v) }));
      }
      if (sql.includes("FROM combos")) return state.combos.get(String(params[0])) ?? [];
      return [];
    }),
    run: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("UPDATE apiKeys SET isActive = 0")) {
        let changes = 0;
        for (const v of state.keys.values()) if (v.userId === params[1] && v.isActive) { v.isActive = 0; changes++; }
        return { changes };
      }
      if (sql.startsWith("UPDATE apiKeys SET key")) {
        const hit = keyRow(String(params[7]), String(params[8]));
        if (hit) hit[1].isActive = Number(params[3]);
        return { changes: 1 };
      }
      if (sql.startsWith("DELETE FROM apiKeys")) {
        const hit = keyRow(String(params[0]), String(params[1]));
        if (hit) state.keys.delete(hit[0]);
        return { changes: hit ? 1 : 0 };
      }
      if (sql.startsWith("INSERT INTO kv")) {
        const per = state.disabled.get(String(params[0])) ?? {};
        per[String(params[2])] = JSON.parse(String(params[3]));
        state.disabled.set(String(params[0]), per);
      }
      if (sql.startsWith("DELETE FROM kv")) state.disabled.get(String(params[0])) && delete state.disabled.get(String(params[0]))![String(params[2])];
      if (sql.startsWith("INSERT INTO combos")) {
        const list = state.combos.get(String(params[1])) ?? [];
        list.push({ id: params[0], name: params[2], kind: null, models: params[4], routing: null, createdAt: "", updatedAt: "" });
        state.combos.set(String(params[1]), list);
      }
      if (sql.startsWith("UPDATE combos SET")) {
        const c = (state.combos.get(String(params[5])) ?? []).find((x) => x.id === params[6]);
        if (c) c.name = params[0];
        return { changes: 1 };
      }
      if (sql.startsWith("DELETE FROM combos")) {
        state.combos.set(String(params[0]), (state.combos.get(String(params[0])) ?? []).filter((c) => c.id !== params[1]));
        return { changes: 1 };
      }
      if (sql.startsWith("INSERT INTO settings")) state.settings = String(params[1]);
      return { changes: 1 };
    }),
    transaction: vi.fn(async (fn: () => Promise<void>) => fn()),
  };
  return { state, adapter };
});
vi.mock("@/lib/db/driver", () => ({ getAdapter: async () => db.adapter }));

const apiKeys = await import("@/lib/db/repos/apiKeysRepo");
const disabled = await import("@/lib/db/repos/disabledModelsRepo");
const combos = await import("@/lib/db/repos/combosRepo");
const settings = await import("@/lib/db/repos/settingsRepo");
const { withTenant } = await import("@/lib/db/tenant");

const calls = (sqlPart: string) =>
  [...db.adapter.get.mock.calls, ...db.adapter.all.mock.calls].filter(([sql]) => String(sql).includes(sqlPart)).length;

// O cache vive no módulo; cada teste usa contas novas para não herdar o anterior.
let A = "";
let B = "";
let seq = 0;

beforeEach(() => {
  seq++;
  A = `tenant-a-${seq}`;
  B = `tenant-b-${seq}`;
  vi.clearAllMocks();
  db.state.keys.clear();
  db.state.disabled.clear();
  db.state.combos.clear();
  db.state.keys.set("sk-a", { id: "k-a", userId: "tenant-a", isActive: 1, profile: null });
  db.state.keys.set("sk-b", { id: "k-b", userId: "tenant-b", isActive: 1, profile: null });
  apiKeys.invalidateApiKeyOwnerCache();
});

describe("resolveApiKeyOwner cache", () => {
  it("a segunda chamada da mesma chave não vai ao banco", async () => {
    const first = await apiKeys.resolveApiKeyOwner("sk-a");
    const second = await apiKeys.resolveApiKeyOwner("sk-a");
    expect(first).toEqual({ userId: "tenant-a", id: "k-a", profile: null });
    expect(second).toEqual(first);
    expect(calls("WHERE key = ?")).toBe(1);
  });

  it("chave desconhecida não é guardada: uma chave recém-criada resolve na hora", async () => {
    expect(await apiKeys.resolveApiKeyOwner("sk-new")).toBeNull();
    db.state.keys.set("sk-new", { id: "k-n", userId: "tenant-a", isActive: 1, profile: null });
    expect((await apiKeys.resolveApiKeyOwner("sk-new"))?.id).toBe("k-n");
  });

  it("chaves de contas diferentes nunca se misturam", async () => {
    expect((await apiKeys.resolveApiKeyOwner("sk-a"))?.userId).toBe("tenant-a");
    expect((await apiKeys.resolveApiKeyOwner("sk-b"))?.userId).toBe("tenant-b");
  });

  it("revogar a chave invalida: a próxima chamada já nega", async () => {
    await apiKeys.resolveApiKeyOwner("sk-a");
    await withTenant("tenant-a", () => apiKeys.revokeApiKeysForSink("manual"));
    expect(await apiKeys.resolveApiKeyOwner("sk-a")).toBeNull();
  });

  it("desativar via updateApiKey invalida", async () => {
    await apiKeys.resolveApiKeyOwner("sk-a");
    await withTenant("tenant-a", () => apiKeys.updateApiKey("k-a", { isActive: false }));
    expect(await apiKeys.resolveApiKeyOwner("sk-a")).toBeNull();
  });

  it("apagar a chave invalida", async () => {
    await apiKeys.resolveApiKeyOwner("sk-a");
    await withTenant("tenant-a", () => apiKeys.deleteApiKey("k-a"));
    expect(await apiKeys.resolveApiKeyOwner("sk-a")).toBeNull();
  });
});

describe("getDisabledModels cache", () => {
  it("leituras seguidas da mesma conta viram uma query", async () => {
    db.state.disabled.set(A, { openai: ["gpt-x"] });
    await withTenant(A, async () => {
      await disabled.getDisabledModels();
      expect(await disabled.getDisabledModels()).toEqual({ openai: ["gpt-x"] });
    });
    expect(calls("FROM kv")).toBe(1);
  });

  it("uma conta nunca lê o cache da outra", async () => {
    db.state.disabled.set(A, { openai: ["gpt-x"] });
    await withTenant(A, () => disabled.getDisabledModels());
    expect(await withTenant(B, () => disabled.getDisabledModels())).toEqual({});
  });

  it("disableModels e enableModels invalidam", async () => {
    await withTenant(A, async () => {
      expect(await disabled.getDisabledModels()).toEqual({});
      await disabled.disableModels("openai", ["gpt-x"]);
      expect(await disabled.getDisabledModels()).toEqual({ openai: ["gpt-x"] });
      await disabled.enableModels("openai");
      expect(await disabled.getDisabledModels()).toEqual({});
    });
  });

  it("o chamador pode mutar o resultado sem sujar o cache", async () => {
    db.state.disabled.set(A, { openai: ["gpt-x"] });
    await withTenant(A, async () => {
      (await disabled.getDisabledModels()).openai!.push("sujo");
      expect(await disabled.getDisabledModels()).toEqual({ openai: ["gpt-x"] });
    });
  });
});

describe("getComboByName cache", () => {
  it("buscas repetidas, inclusive de nome inexistente, viram uma query", async () => {
    await withTenant(A, async () => {
      await combos.createCombo({ name: "dev", models: ["a/b"] });
      vi.clearAllMocks();
      expect((await combos.getComboByName("dev"))?.name).toBe("dev");
      expect(await combos.getComboByName("gpt-4o")).toBeNull();
      expect(await combos.getComboByName("dev")).not.toBeNull();
    });
    expect(calls("FROM combos")).toBe(1);
  });

  it("uma conta nunca vê o combo da outra", async () => {
    await withTenant(A, () => combos.createCombo({ name: "dev", models: [] }));
    await withTenant(A, () => combos.getComboByName("dev"));
    expect(await withTenant(B, () => combos.getComboByName("dev"))).toBeNull();
  });

  it("criar, renomear e apagar invalidam", async () => {
    await withTenant(A, async () => {
      expect(await combos.getComboByName("dev")).toBeNull();
      const created = await combos.createCombo({ name: "dev", models: [] });
      expect(await combos.getComboByName("dev")).not.toBeNull();
      await combos.updateCombo(created.id, { name: "prod" });
      expect(await combos.getComboByName("dev")).toBeNull();
      expect(await combos.getComboByName("prod")).not.toBeNull();
      await combos.deleteCombo(created.id);
      expect(await combos.getComboByName("prod")).toBeNull();
    });
  });
});

describe("getSettings TTL", () => {
  it("segura a leitura por mais que 2s", async () => {
    vi.useFakeTimers();
    try {
      await withTenant("tenant-ttl", async () => {
        await settings.getSettings();
        vi.advanceTimersByTime(10_000);
        await settings.getSettings();
      });
      expect(calls("FROM settings")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expira dentro de uma janela curta", async () => {
    vi.useFakeTimers();
    try {
      await withTenant("tenant-ttl2", async () => {
        await settings.getSettings();
        vi.advanceTimersByTime(31_000);
        await settings.getSettings();
      });
      expect(calls("FROM settings")).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
