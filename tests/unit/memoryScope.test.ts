import { beforeEach, describe, expect, it, vi } from "vitest";

const listEntries = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const updateEntry = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/db/repos/agentMemoryRepo", () => ({
  deleteAgentMemoryEntry: vi.fn(),
  getAgentMemoryRevision: vi.fn(async () => 1),
  insertAgentMemoryEntry: vi.fn(),
  listAgentMemoryEntries: listEntries,
  totalChars: (entries: Array<{ content: string }>) =>
    entries.reduce((total, entry) => total + entry.content.length, 0),
  updateAgentMemoryEntry: updateEntry,
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

import { applyMemoryWrite } from "@/server/harness/memory/applyMemoryWrite";

describe("memory scope enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEntries.mockResolvedValue([
      {
        id: "user-pref",
        scope: "user",
        content: "Old preference",
        createdAt: "2026-09-03T10:00:00.000Z",
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    ]);
  });

  it("checks the persisted user scope when replace omits scope", async () => {
    getConfig.mockResolvedValue({
      memoryWriteApproval: false,
      memoryAgentEnabled: true,
      memoryUserEnabled: false,
    });

    const result = await applyMemoryWrite({
      action: "replace",
      id: "user-pref",
      content: "New preference",
      source: "ui",
    });

    expect(result).toMatchObject({ ok: false, error: "User memory is disabled" });
    expect(updateEntry).not.toHaveBeenCalled();
  });
});
