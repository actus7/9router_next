import { beforeEach, describe, expect, it, vi } from "vitest";

const getPending = vi.hoisted(() => vi.fn());
const listPending = vi.hoisted(() => vi.fn(async () => []));
const resolvePending = vi.hoisted(() => vi.fn(async () => {}));
const applyPluginToggle = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("@/lib/db/repos/harnessPendingWritesRepo", () => ({
  getHarnessPendingWrite: getPending,
  listHarnessPendingWrites: listPending,
  resolveHarnessPendingWrite: resolvePending,
  insertHarnessPendingWrite: vi.fn(),
}));

vi.mock("@/lib/db/repos/agentMemoryRepo", () => ({
  deleteAgentMemoryEntry: vi.fn(),
  getAgentMemoryRevision: vi.fn(),
  insertAgentMemoryEntry: vi.fn(),
  listAgentMemoryEntries: vi.fn(async () => []),
  totalChars: vi.fn(() => 0),
  updateAgentMemoryEntry: vi.fn(),
}));

vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({
  getHarnessLearningConfig: vi.fn(async () => ({
    memoryWriteApproval: true,
    memoryAgentEnabled: true,
    memoryUserEnabled: true,
  })),
}));

vi.mock("@/server/harness/governance/applyPluginWrite", () => ({
  applyPluginToggle,
}));

import {
  approvePendingWrite,
  listPendingWrites,
  rejectPendingWrite,
} from "@/server/harness/memory/applyMemoryWrite";

describe("pending write governance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists all pending kinds", async () => {
    await listPendingWrites();
    expect(listPending).toHaveBeenCalledWith(undefined, "pending");
  });

  it("accepts capability proposals without installing executable code", async () => {
    getPending.mockResolvedValue({
      id: "proposal-1",
      kind: "plugin",
      action: "propose",
      payload: { title: "New tool", description: "Does work", toolName: "new_tool" },
      source: "agent",
      status: "pending",
      createdAt: "2026-09-03T10:00:00.000Z",
    });

    const result = await approvePendingWrite("proposal-1");

    expect(result).toMatchObject({ ok: true, outcome: "accepted_for_implementation" });
    expect(applyPluginToggle).not.toHaveBeenCalled();
    expect(resolvePending).toHaveBeenCalledWith(
      "proposal-1",
      "accepted",
      expect.objectContaining({ outcome: "accepted_for_implementation" }),
    );
  });

  it("records rejections instead of deleting the audit row", async () => {
    getPending.mockResolvedValue({ id: "pending-1", status: "pending" });
    await expect(rejectPendingWrite("pending-1")).resolves.toMatchObject({
      ok: true,
      outcome: "rejected",
    });
    expect(resolvePending).toHaveBeenCalledWith(
      "pending-1",
      "rejected",
      expect.objectContaining({ outcome: "rejected" }),
    );
  });
});
