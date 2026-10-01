import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `auto` write-risk mode: a confidently Harmless/Low agent write is
 * applied outright and recorded as `auto_applied`; everything else queues for
 * the operator exactly as before. Jev being unreachable is fail-safe — the
 * write queues.
 */

const insertEntry = vi.hoisted(() =>
  vi.fn(async (entry: Record<string, unknown>) => ({
    ...entry,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  })),
);
const updateEntry = vi.hoisted(() => vi.fn(async () => {}));
const deleteEntry = vi.hoisted(() => vi.fn(async () => {}));
const listEntries = vi.hoisted(() => vi.fn());
const insertPending = vi.hoisted(() =>
  vi.fn(async (write: Record<string, unknown>, status = "pending") => ({
    ...write,
    status,
    createdAt: "2026-10-01T00:00:00.000Z",
  })),
);
const listPending = vi.hoisted(() => vi.fn(async () => []));
const decideWithJev = vi.hoisted(() => vi.fn());
const scanUntrustedContent = vi.hoisted(() =>
  vi.fn(async () => ({ issues: [], source: "heuristic" })),
);
const getConfig = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repos/agentMemoryRepo", () => ({
  insertAgentMemoryEntry: insertEntry,
  updateAgentMemoryEntry: updateEntry,
  deleteAgentMemoryEntry: deleteEntry,
  listAgentMemoryEntries: listEntries,
  getAgentMemoryRevision: vi.fn(async () => 0),
  totalChars: (entries: Array<{ content: string }>) =>
    entries.reduce((total, entry) => total + entry.content.length, 0),
}));

vi.mock("@/lib/db/repos/harnessPendingWritesRepo", () => ({
  insertHarnessPendingWrite: insertPending,
  listHarnessPendingWrites: listPending,
  getHarnessPendingWrite: vi.fn(async () => null),
  resolveHarnessPendingWrite: vi.fn(async () => {}),
}));

vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({
  getHarnessLearningConfig: getConfig,
  updateHarnessLearningConfig: vi.fn(async () => ({})),
}));

vi.mock("@/server/decisions/jev", () => ({
  decideWithJev,
  JEV_MODEL: "typesafe-ai/jev",
}));

vi.mock("@/server/decisions/guardrails", () => ({ scanUntrustedContent }));

import { applyMemoryWrite } from "@/server/harness/memory/applyMemoryWrite";

function config(overrides: Record<string, unknown> = {}) {
  return {
    memoryWriteApproval: true,
    skillWriteApproval: true,
    memoryAgentEnabled: true,
    memoryUserEnabled: true,
    learningReviewEnabled: false,
    learningReviewModel: "",
    learningDeferWhenBusy: true,
    memoryNotifications: true,
    writeRiskMode: "auto",
    ...overrides,
  };
}

function jevScore(score: number, confidence: number) {
  return {
    answers: { risk: { type: "score", score, confidence, probabilities: {} } },
    source: "jev",
  };
}

const addRequest = {
  action: "add" as const,
  scope: "agent" as const,
  content: "The user prefers Portuguese for replies",
  source: "agent" as const,
};

const memoryEntry = {
  id: "e1",
  scope: "agent",
  content: "Old note",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

describe("writeRisk auto mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfig.mockResolvedValue(config());
    listEntries.mockResolvedValue([]);
    decideWithJev.mockResolvedValue(jevScore(0.8, 0.95));
    scanUntrustedContent.mockResolvedValue({ issues: [], source: "heuristic" });
  });

  it("applies a Harmless write outright and records the auto_applied trail", async () => {
    decideWithJev.mockResolvedValue(jevScore(0.8, 0.95));

    const result = await applyMemoryWrite(addRequest);

    expect(result).toMatchObject({ ok: true, autoApplied: true });
    expect(result.pending).toBeUndefined();
    expect(result.entry?.content).toBe(addRequest.content);
    expect(insertEntry).toHaveBeenCalledOnce();
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "memory",
        action: "add",
        source: "agent",
        risk: { score: 0.8, confidence: 0.95, model: "typesafe-ai/jev" },
      }),
      "auto_applied",
    );
  });

  it("applies a Low write (1.4) with confidence 0.92", async () => {
    decideWithJev.mockResolvedValue(jevScore(1.4, 0.92));

    const result = await applyMemoryWrite(addRequest);

    expect(result).toMatchObject({ ok: true, autoApplied: true });
    expect(insertEntry).toHaveBeenCalledOnce();
    expect(insertPending).toHaveBeenCalledWith(expect.anything(), "auto_applied");
  });

  it("queues a Notable score (1.6) instead of auto-applying", async () => {
    decideWithJev.mockResolvedValue(jevScore(1.6, 0.95));

    const result = await applyMemoryWrite(addRequest);

    expect(result).toMatchObject({ ok: true, pending: true });
    expect(result.autoApplied).toBeUndefined();
    expect(insertEntry).not.toHaveBeenCalled();
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        risk: { score: 1.6, confidence: 0.95, model: "typesafe-ai/jev" },
      }),
    );
    expect(insertPending.mock.calls[0]![1]).toBeUndefined();
  });

  it("queues a low score whose confidence is below 0.9", async () => {
    decideWithJev.mockResolvedValue(jevScore(0.5, 0.85));

    const result = await applyMemoryWrite(addRequest);

    expect(result).toMatchObject({ ok: true, pending: true });
    expect(insertEntry).not.toHaveBeenCalled();
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertPending.mock.calls[0]![1]).toBeUndefined();
  });

  it("always queues in advisory mode, whatever the score", async () => {
    getConfig.mockResolvedValue(config({ writeRiskMode: "advisory" }));
    decideWithJev.mockResolvedValue(jevScore(0, 1));

    const result = await applyMemoryWrite(addRequest);

    expect(result).toMatchObject({ ok: true, pending: true });
    expect(insertEntry).not.toHaveBeenCalled();
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertPending.mock.calls[0]![1]).toBeUndefined();
  });

  it("always queues removals, whatever the score", async () => {
    listEntries.mockResolvedValue([memoryEntry]);
    decideWithJev.mockResolvedValue(jevScore(0, 1));

    const result = await applyMemoryWrite({
      action: "remove",
      id: "e1",
      source: "agent",
    });

    expect(result).toMatchObject({ ok: true, pending: true });
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertPending.mock.calls[0]![1]).toBeUndefined();
  });

  it("queues when Jev cannot answer — fail-safe, never auto-applies blind", async () => {
    decideWithJev.mockResolvedValue(null);

    const result = await applyMemoryWrite(addRequest);

    expect(result).toMatchObject({ ok: true, pending: true });
    expect(insertEntry).not.toHaveBeenCalled();
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertPending.mock.calls[0]![0]).not.toHaveProperty("risk");
    expect(insertPending.mock.calls[0]![1]).toBeUndefined();
  });

  it("writes operator (ui) requests directly, with no trail row", async () => {
    const result = await applyMemoryWrite({ ...addRequest, source: "ui" });

    expect(result).toMatchObject({ ok: true });
    expect(result.autoApplied).toBeUndefined();
    expect(result.pending).toBeUndefined();
    expect(insertEntry).toHaveBeenCalledOnce();
    expect(insertPending).not.toHaveBeenCalled();
  });
});
