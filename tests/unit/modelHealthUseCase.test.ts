import { beforeEach, describe, expect, it, vi } from "vitest";

const hour = new Date().toISOString().slice(0, 13);
const perfRows = vi.fn(async () => [
  { modelKey: "zai/glm", hourKey: hour, ok: 90, fail: 10, timeout: 2, b: [80, 10, 0, 0, 0, 0, 0, 0, 0, 0] },
]);
const connections = vi.fn(async () => [
  { id: "c1", provider: "zai" },
  { id: "c2", provider: "zai" },
  { id: "c3", provider: "opencode" },
]);
const availability = vi.fn(async (): Promise<Array<Record<string, unknown>>> => []);
const clearAvail = vi.fn(async () => 3);
const clearPerf = vi.fn(async () => {});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repos/modelPerfRepo", () => ({ readModelPerf: () => perfRows(), clearModelPerf: () => clearPerf() }));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: () => connections() }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: () => availability(),
  clearAllModelAvailability: () => clearAvail(),
}));
vi.mock("@/shared/constants/providers", () => ({ getProviderAlias: (id: string) => (id === "opencode" ? "oc" : id) }));

import { getModelHealth, resetModelHealth } from "@/server/application/use-cases/modelHealth";
import { clearModelPenalties, recordModelFailure } from "@/server/llm-gateway/engine/services/modelPenalty";

const soon = () => new Date(Date.now() + 5 * 60_000).toISOString();

describe("getModelHealth", () => {
  beforeEach(() => {
    clearModelPenalties();
    availability.mockResolvedValue([]);
  });

  it("reports success rate, sample count and TTFT percentiles from measurements", async () => {
    const rows = await getModelHealth();
    const glm = rows.find((r) => r.model === "zai/glm")!;
    expect(glm.state).toBe("ok");
    expect(glm.successRate).toBeCloseTo(0.9, 2);
    expect(glm.samples).toBe(100);
    expect(glm.p50Ms).toBe(250);
    expect(glm.p95Ms).toBe(500);
  });

  it("marks a penalized model and keeps it visible without measurements", async () => {
    recordModelFailure("oc/free", 429);
    const free = (await getModelHealth()).find((r) => r.model === "oc/free")!;
    expect(free.state).toBe("penalized");
    expect(free.penalty).toBe(3);
    expect(free.successRate).toBeNull();
  });

  it("says cooldown when every account of the provider is cooling, partial when only some are", async () => {
    availability.mockResolvedValue([
      { connectionId: "c1", modelId: "glm", reason: "rate_limit", until: soon(), errorCode: 429 },
    ]);
    expect((await getModelHealth()).find((r) => r.model === "zai/glm")).toMatchObject({ state: "partial", cooldownAccounts: 1, accounts: 2 });

    availability.mockResolvedValue([
      { connectionId: "c1", modelId: "glm", reason: "rate_limit", until: soon(), errorCode: 429 },
      { connectionId: "c2", modelId: "glm", reason: "rate_limit", until: soon(), errorCode: 429 },
    ]);
    const full = (await getModelHealth()).find((r) => r.model === "zai/glm")!;
    expect(full.state).toBe("cooldown");
    expect(full.reason).toBe("rate_limit");
    expect(full.cooldownUntil).toBeTruthy();
  });

  it("uses the provider alias the combos use, and ignores whole-connection locks", async () => {
    availability.mockResolvedValue([
      { connectionId: "c3", modelId: "free", reason: "transient", until: soon(), errorCode: 503 },
      { connectionId: "c3", modelId: "__all", reason: "billing", until: soon(), errorCode: 402 },
    ]);
    const rows = await getModelHealth();
    expect(rows.find((r) => r.model === "oc/free")?.state).toBe("cooldown");
    expect(rows.some((r) => r.model.endsWith("/__all"))).toBe(false);
  });

  it("lists the worst states first", async () => {
    recordModelFailure("a/penalized", 429);
    availability.mockResolvedValue([
      { connectionId: "c3", modelId: "free", reason: "transient", until: soon(), errorCode: 503 },
    ]);
    const states = (await getModelHealth()).map((r) => r.state);
    expect(states[0]).toBe("cooldown");
    expect(states.at(-1)).toBe("ok");
  });
});

describe("resetModelHealth", () => {
  beforeEach(() => clearModelPenalties());

  it("clears penalties, measurements and cooldowns, and reports what it cleared", async () => {
    recordModelFailure("a/m", 429);
    const result = await resetModelHealth();
    expect(result).toEqual({ penalties: 1, cooldowns: 3 });
    expect(clearPerf).toHaveBeenCalled();
    expect(clearAvail).toHaveBeenCalled();
    expect(await getModelHealth().then((r) => r.some((x) => x.state === "penalized"))).toBe(false);
  });
});
