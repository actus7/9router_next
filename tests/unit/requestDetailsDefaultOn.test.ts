import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Observabilidade era desligada por padrão, então numa conta nova a aba
 * "Detalhes" ficava vazia para sempre — a tela contava a requisição no resumo e
 * não sabia mostrar nada dela. Este teste percorre o `getSettings` de verdade
 * (sem mockar o repo de settings) para provar que uma conta que nunca gravou
 * nada já grava detalhes.
 */
const run = vi.fn(async () => undefined);
const get = vi.fn(async (sql: string) => {
  // A conta nunca tocou em `enableObservability` — quem decide é o
  // DEFAULT_SETTINGS. `observabilityBatchSize` só está aqui para o buffer
  // esvaziar no primeiro item em vez de esperar 20.
  if (sql.includes("FROM settings")) return { data: JSON.stringify({ observabilityBatchSize: 1 }) };
  return { c: 0 };
});
const getAdapter = vi.fn(async () => ({
  run,
  get,
  all: async () => [],
  exec: async () => undefined,
  transaction: async (fn: () => Promise<void>) => { await fn(); },
}));

vi.mock("@/lib/db/driver", () => ({ getAdapter }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("saveRequestDetail on a fresh account", () => {
  it("records without the operator turning anything on", async () => {
    const { saveRequestDetail } = await import("@/lib/db/repos/requestDetailsRepo");
    const { withTenant } = await import("@/lib/db/tenant");

    await withTenant("acct-new", () => saveRequestDetail({ provider: "quillbot", model: "quillbot/x", status: "success" }));

    expect(run).toHaveBeenCalled();
    const [sql, params] = run.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO requestDetails");
    expect(params[1]).toBe("acct-new");
  });
});
