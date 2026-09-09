import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Usage screen shows two things from two tables. Overview counts every
 * request out of `usageHistory`, which is always written; the Details tab reads
 * `requestDetails`, which `saveRequestDetail` refuses to write while
 * `enableObservability` is off — and `DEFAULT_SETTINGS` has it off.
 *
 * So on a fresh install Details is empty no matter what the summary says, and
 * it used to explain that as "No request details found", which reads as an
 * empty filter result. The behaviour is deliberate; the message was not.
 */
const settings = { enableObservability: false, observabilityBatchSize: 1, observabilityMaxRecords: 1000 };
const run = vi.fn(async () => undefined);
const get = vi.fn(async () => ({ c: 0 }));
const getAdapter = vi.fn(async () => ({
  run,
  get,
  all: async () => [],
  exec: async () => undefined,
  transaction: async (fn: () => Promise<void>) => { await fn(); },
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: async () => ({ ...settings }) }));
vi.mock("@/lib/db/driver", () => ({ getAdapter }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function save(detail: Record<string, unknown>) {
  // Both from the same module generation: `vi.resetModules()` between tests
  // gives the repo a fresh `tenant.ts`, and a `withTenant` captured from the
  // previous one writes to a different AsyncLocalStorage instance.
  const { saveRequestDetail } = await import("@/lib/db/repos/requestDetailsRepo");
  const { withTenant } = await import("@/lib/db/tenant");
  await withTenant("acct-1", () => saveRequestDetail(detail));
}

describe("saveRequestDetail", () => {
  it("records nothing while observability is off", async () => {
    settings.enableObservability = false;

    await save({ provider: "quillbot", model: "quillbot/x", status: "success" });

    expect(getAdapter).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("writes once the operator turns it on", async () => {
    settings.enableObservability = true;

    await save({ provider: "quillbot", model: "quillbot/x", status: "success" });

    expect(run).toHaveBeenCalled();
    const [sql, params] = run.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO requestDetails");
    expect(params[1]).toBe("acct-1");
  });
});
