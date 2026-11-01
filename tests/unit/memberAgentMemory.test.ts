import { beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const insertEntry = vi.hoisted(() => vi.fn());
const queueWrite = vi.hoisted(() => vi.fn(async () => {}));
const assessRisk = vi.hoisted(() => vi.fn(async () => ({ score: 0.01 })));
const canAutoApply = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db/repos/agentMemoryRepo", () => ({
  deleteAgentMemoryEntry: vi.fn(),
  getAgentMemoryRevision: vi.fn(async () => 1),
  insertAgentMemoryEntry: insertEntry,
  listAgentMemoryEntries: listEntries,
  totalChars: (entries: Array<{ content: string }>) =>
    entries.reduce((total, entry) => total + entry.content.length, 0),
  updateAgentMemoryEntry: vi.fn(),
}));

vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({
  getHarnessLearningConfig: getConfig,
}));

vi.mock("@/lib/db/repos/harnessPendingWritesRepo", () => ({
  getHarnessPendingWrite: vi.fn(),
  insertHarnessPendingWrite: vi.fn(),
  listHarnessPendingWrites: vi.fn(),
  resolveHarnessPendingWrite: vi.fn(),
}));

vi.mock("@/server/harness/governance/queuePendingWrite", () => ({
  assessWriteRisk: assessRisk,
  canAutoApplyWrite: canAutoApply,
  queuePendingWrite: queueWrite,
  recordAutoAppliedWrite: vi.fn(async () => {}),
}));

vi.mock("@/server/harness/memory/securityScan", () => ({
  scanMemoryContentAsync: vi.fn(async () => []),
}));

import { withTenant, type TenantContext } from "@/lib/db/tenant";
import { applyMemoryWrite, type MemoryApplyRequest } from "@/server/harness/memory/applyMemoryWrite";

const asRole = (role: TenantContext["role"]) => ({
  tenantId: "t1",
  actorUserId: "m1",
  role,
});

const write = (role: TenantContext["role"], request: MemoryApplyRequest) =>
  withTenant(asRole(role), () => applyMemoryWrite(request));

describe("member writes to the team's shared agent memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAutoApply.mockReturnValue(true);
    insertEntry.mockImplementation(async (e: { id: string; scope: string; content: string }) => ({
      ...e,
      createdAt: "2026-10-31T00:00:00.000Z",
      updatedAt: "2026-10-31T00:00:00.000Z",
    }));
    getConfig.mockResolvedValue({
      memoryWriteApproval: false,
      writeRiskMode: "auto",
      memoryAgentEnabled: true,
      memoryUserEnabled: true,
    });
    listEntries.mockResolvedValue([
      {
        id: "team-note",
        scope: "agent",
        content: "Existing",
        createdAt: "2026-10-31T00:00:00.000Z",
        updatedAt: "2026-10-31T00:00:00.000Z",
      },
    ]);
  });

  it("queues a member's agent-scope add instead of applying it", async () => {
    const result = await write("member", { action: "add", scope: "agent", content: "x", source: "agent" });
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(queueWrite).toHaveBeenCalled();
    expect(insertEntry).not.toHaveBeenCalled();
  });

  it("queues a member's remove of an agent-scope entry", async () => {
    const result = await write("member", { action: "remove", id: "team-note", source: "agent" });
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(queueWrite).toHaveBeenCalled();
  });

  it("applies a member's user-scope add directly", async () => {
    const result = await write("member", { action: "add", scope: "user", content: "x", source: "agent" });
    expect(result.pending).toBeUndefined();
    expect(insertEntry).toHaveBeenCalled();
    expect(queueWrite).not.toHaveBeenCalled();
  });

  it("applies an admin's agent-scope add directly", async () => {
    const result = await write("admin", { action: "add", scope: "agent", content: "x", source: "agent" });
    expect(result.pending).toBeUndefined();
    expect(insertEntry).toHaveBeenCalled();
    expect(queueWrite).not.toHaveBeenCalled();
  });

  it("does not auto-apply a member's low-risk agent-scope add", async () => {
    const result = await write("member", { action: "add", scope: "agent", content: "x", source: "agent" });
    expect(result).toMatchObject({ pending: true });
    expect(result.autoApplied).toBeUndefined();
    expect(insertEntry).not.toHaveBeenCalled();
  });
});
