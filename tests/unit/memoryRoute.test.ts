import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listEntries,
  getRevision,
  insertEntry,
  updateEntry,
  deleteEntry,
  listPending,
  insertPending,
  getConfig,
} = vi.hoisted(() => ({
  listEntries: vi.fn(async () => []),
  getRevision: vi.fn(async () => 0),
  insertEntry: vi.fn(async (entry: unknown) => ({
    ...(entry as object),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
  updateEntry: vi.fn(async () => {}),
  deleteEntry: vi.fn(async () => {}),
  listPending: vi.fn(async () => []),
  insertPending: vi.fn(async (write: unknown) => ({
    ...(write as object),
    createdAt: "2026-01-01T00:00:00.000Z",
  })),
  getConfig: vi.fn(async () => ({
    memoryWriteApproval: true,
    memoryAgentEnabled: true,
    memoryUserEnabled: true,
    learningReviewEnabled: false,
    learningReviewModel: "",
    learningDeferWhenBusy: true,
    memoryNotifications: true,
  })),
}));

vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));

vi.mock("@/lib/db/repos/agentMemoryRepo", () => ({
  listAgentMemoryEntries: listEntries,
  getAgentMemoryRevision: getRevision,
  insertAgentMemoryEntry: insertEntry,
  updateAgentMemoryEntry: updateEntry,
  deleteAgentMemoryEntry: deleteEntry,
  totalChars: (entries: Array<{ content: string }>) =>
    entries.reduce((sum, entry) => sum + entry.content.length, 0),
}));

vi.mock("@/lib/db/repos/harnessPendingWritesRepo", () => ({
  listHarnessPendingWrites: listPending,
  insertHarnessPendingWrite: insertPending,
  deleteHarnessPendingWrite: vi.fn(async () => {}),
  getHarnessPendingWrite: vi.fn(async () => null),
}));

vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({
  getHarnessLearningConfig: getConfig,
  updateHarnessLearningConfig: vi.fn(async (patch: Record<string, unknown>) => ({
    memoryWriteApproval: true,
    memoryAgentEnabled: true,
    memoryUserEnabled: true,
    learningReviewEnabled: false,
    learningReviewModel: "",
    learningDeferWhenBusy: true,
    memoryNotifications: true,
    ...patch,
  })),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "@/server/application/use-cases/http/harness/memory/route";

const url = "http://localhost/api/harness/memory";

beforeEach(() => {
  vi.clearAllMocks();
  listEntries.mockResolvedValue([]);
  getRevision.mockResolvedValue(0);
});

describe("GET /api/harness/memory", () => {
  it("returns snapshot and config", async () => {
    const payload = await (await GET()).json();
    expect(payload.ok).toBe(true);
    expect(payload.agent).toEqual([]);
    expect(payload.config.memoryWriteApproval).toBe(true);
  });
});

describe("POST /api/harness/memory", () => {
  it("queues agent writes when approval is enabled", async () => {
    const response = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          scope: "agent",
          content: "Remember this fact",
          source: "agent",
        }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.pending).toBe(true);
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertEntry).not.toHaveBeenCalled();
  });
});
