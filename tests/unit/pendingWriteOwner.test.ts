import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTenant } from "@/lib/db/tenant";

const getPending = vi.hoisted(() => vi.fn());
const resolvePending = vi.hoisted(() => vi.fn(async () => {}));
const dbRun = vi.hoisted(() => vi.fn(async () => {}));
const actorAtApply = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: async () => ({ run: dbRun, all: vi.fn(), get: vi.fn() }),
}));

vi.mock("@/lib/db/repos/harnessPendingWritesRepo", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/db/repos/harnessPendingWritesRepo")
  >("@/lib/db/repos/harnessPendingWritesRepo");
  return {
    ...actual,
    getHarnessPendingWrite: getPending,
    resolveHarnessPendingWrite: resolvePending,
  };
});

vi.mock("@/lib/db/repos/agentMemoryRepo", async () => {
  const { currentActorUserId: actor } = await import("@/lib/db/tenant");
  return {
    deleteAgentMemoryEntry: vi.fn(),
    getAgentMemoryRevision: vi.fn(),
    insertAgentMemoryEntry: vi.fn(async () => {
      actorAtApply.value = actor();
      return { id: "m", scope: "user", content: "x", createdAt: "", updatedAt: "" };
    }),
    listAgentMemoryEntries: vi.fn(async () => []),
    totalChars: vi.fn(() => 0),
    updateAgentMemoryEntry: vi.fn(),
  };
});

vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({
  getHarnessLearningConfig: vi.fn(async () => ({
    memoryWriteApproval: false,
    memoryAgentEnabled: true,
    memoryUserEnabled: true,
  })),
}));

import { insertHarnessPendingWrite } from "@/lib/db/repos/harnessPendingWritesRepo";
import { approvePendingWrite } from "@/server/harness/memory/applyMemoryWrite";

const admin = { tenantId: "t1", actorUserId: "a1", role: "admin" as const };
const member = { tenantId: "t1", actorUserId: "m1", role: "member" as const };

function pendingRow(scope: "user" | "agent", ownerUserId?: string) {
  return {
    id: "p1",
    kind: "memory",
    action: "add",
    payload: { scope, content: "gosto de cafe" },
    source: "agent",
    status: "pending",
    createdAt: "2026-10-31T00:00:00.000Z",
    ...(ownerUserId ? { ownerUserId } : {}),
  };
}

async function approveAsAdmin(): Promise<void> {
  await withTenant(admin, () => approvePendingWrite("p1"));
}

describe("pending write owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorAtApply.value = null;
  });

  it("stores the requesting member as the owner of the pending row", async () => {
    await withTenant(member, () =>
      insertHarnessPendingWrite({
        id: "p1",
        kind: "memory",
        action: "add",
        payload: { scope: "user", content: "x" },
        source: "agent",
      }),
    );
    const [sql, params] = dbRun.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("ownerUserId");
    expect(params).toContain("m1");
  });

  it("applies an approved user-scope write as the member who asked", async () => {
    getPending.mockResolvedValue(pendingRow("user", "m1"));
    await approveAsAdmin();
    expect(actorAtApply.value).toBe("m1");
    expect(resolvePending).toHaveBeenCalledWith("p1", "applied", { outcome: "applied" });
  });

  it("applies an approved agent-scope write as the approver", async () => {
    getPending.mockResolvedValue(pendingRow("agent", "m1"));
    await approveAsAdmin();
    expect(actorAtApply.value).toBe("a1");
  });

  it("applies a legacy user-scope write without owner as the approver", async () => {
    getPending.mockResolvedValue(pendingRow("user"));
    await approveAsAdmin();
    expect(actorAtApply.value).toBe("a1");
  });
});
