import { beforeEach, describe, expect, it, vi } from "vitest";

const adapter = {
  all: vi.fn(async (_sql: string, _params?: unknown[]): Promise<Array<Record<string, unknown>>> => []),
  run: vi.fn(async (_sql: string, _params?: unknown[]) => ({ changes: 1 })),
};
vi.mock("@/lib/db/driver", () => ({ getAdapter: vi.fn(async () => adapter) }));
vi.mock("@/lib/db/tenant", () => ({ currentTenantId: () => "tenant-1" }));

import { readModelPerf, recordModelAttempt } from "@/lib/db/repos/modelPerfRepo";

describe("recordModelAttempt", () => {
  beforeEach(() => { adapter.run.mockClear(); adapter.all.mockClear(); });

  it("upserts one hour bucket for the tenant, adding to the counters", async () => {
    await recordModelAttempt({ modelKey: "a/m", outcome: "ok", ttftMs: 700 }, Date.UTC(2026, 9, 8, 12, 34));
    const [sql, params] = adapter.run.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO modelPerf/i);
    expect(sql).toMatch(/ON CONFLICT\s*\(userId, modelKey, hourKey\)/i);
    expect(sql).toMatch(/ok = modelPerf\.ok \+ excluded\.ok/);
    expect(params.slice(0, 3)).toEqual(["tenant-1", "a/m", "2026-10-08T12"]);
    // 700ms lands in bucket 2 (<=1000ms): ok=1, fail=0, timeout=0, then b0..b9.
    expect(params.slice(3)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("counts a timeout as both a failure and a timeout, with no TTFT", async () => {
    await recordModelAttempt({ modelKey: "a/m", outcome: "timeout" }, Date.UTC(2026, 9, 8, 12));
    const params = (adapter.run.mock.calls[0] as [string, unknown[]])[1];
    expect(params.slice(3, 6)).toEqual([0, 1, 1]);
    expect(params.slice(6).every((n) => n === 0)).toBe(true);
  });
});

describe("readModelPerf", () => {
  it("reads only the tenant's rows inside the window and maps buckets", async () => {
    adapter.all.mockResolvedValueOnce([
      { modelKey: "a/m", hourKey: "2026-10-08T11", ok: 3, fail: 1, timeout: 0, b0: 2, b1: 0, b2: 1, b3: 0, b4: 0, b5: 0, b6: 0, b7: 0, b8: 0, b9: 0 },
    ]);
    const rows = await readModelPerf(Date.UTC(2026, 9, 8, 12));
    const [sql, params] = adapter.all.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toMatch(/WHERE userId = \?/);
    expect(sql).toMatch(/hourKey >= \?/);
    expect(params[0]).toBe("tenant-1");
    expect(rows).toEqual([{ modelKey: "a/m", hourKey: "2026-10-08T11", ok: 3, fail: 1, timeout: 0, b: [2, 0, 1, 0, 0, 0, 0, 0, 0, 0] }]);
  });
});
