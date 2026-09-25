import { beforeEach, describe, expect, it, vi } from "vitest";

// Um request do gateway lia `settings` 5× (chave, rota, seleção de conta…),
// cada leitura um round trip ao Neon antes do primeiro token.

const db = vi.hoisted(() => {
  let data = JSON.stringify({ requireApiKey: true });
  return {
    get: vi.fn(async () => ({ data })),
    run: vi.fn(async (_sql: string, params: unknown[]) => { data = String(params[1]); }),
    transaction: vi.fn(async (fn: () => Promise<void>) => fn()),
  };
});
vi.mock("@/lib/db/driver", () => ({ getAdapter: async () => db }));

const { getSettings, updateSettings } = await import("@/lib/db/repos/settingsRepo");
const { withTenant } = await import("@/lib/db/tenant");

describe("getSettings memo", () => {
  beforeEach(() => { db.get.mockClear(); });

  it("leituras próximas da mesma conta viram uma query", async () => {
    await withTenant("u-memo-1", async () => {
      await Promise.all([getSettings(), getSettings(), getSettings()]);
      await getSettings();
    });
    expect(db.get).toHaveBeenCalledTimes(1);
  });

  it("contas diferentes não compartilham a leitura", async () => {
    await withTenant("u-memo-a", () => getSettings());
    await withTenant("u-memo-b", () => getSettings());
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it("updateSettings invalida: a leitura seguinte vê o valor novo", async () => {
    await withTenant("u-memo-2", async () => {
      expect((await getSettings()).requireApiKey).toBe(true);
      await updateSettings({ requireApiKey: false });
      expect((await getSettings()).requireApiKey).toBe(false);
    });
  });
});
