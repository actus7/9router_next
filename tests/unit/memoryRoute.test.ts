import { beforeEach, describe, expect, it, vi } from "vitest";

// These suites cover route logic, not the auth gate; tests/unit/dashboardAccess.test.ts
// and tests/unit/harnessRouteAuth.test.ts cover the gate itself.
vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));

// The capability gate ("may this conversation do that?") is a different
// question from the origin gate these suites cover, and has its own suite in
// tests/unit/serverPluginGate.test.ts.
vi.mock("@/server/harness/tools/sessionCapability", () => ({
  sessionHasPlugin: vi.fn(async () => true),
}));

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
import { GET, POST, PUT } from "@/server/application/use-cases/http/harness/memory/route";
import { withTenant } from "@/lib/db/tenant";

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
          sessionId: "S",
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

  it("does not let the request talk itself out of the gate", async () => {
    // POST is the agent's path — the operator's edits arrive on PUT, which
    // sets its own origin server-side. This handler used to read
    // `body.source`, so a write could declare itself an operator action and
    // skip the queue: the gate was chosen by the caller.
    const response = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "S", action: "add", scope: "agent", content: "x", source: "ui" }),
      }),
    );

    expect((await response.json()).pending).toBe(true);
    expect(insertPending).toHaveBeenCalledOnce();
    expect(insertEntry).not.toHaveBeenCalled();
  });
});

describe("PUT /api/harness/memory as a member", () => {
  // Agent memory and the learning config are the whole team's: they ride into
  // every member's chat. A member edits their own memory on this path, and
  // reaches the shared one only through the agent's gated POST.
  const asMember = <T>(fn: () => Promise<T>) =>
    withTenant({ tenantId: "org-1", actorUserId: "member-b", role: "member" }, fn);
  const put = (body: unknown) =>
    new NextRequest(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("refuses the shared learning config", async () => {
    const response = await asMember(() => PUT(put({ config: { memoryWriteApproval: false } })));
    expect(response.status).toBe(403);
  });

  it("refuses creating, editing or deleting shared agent memory", async () => {
    listEntries.mockResolvedValue([{ id: "a1", scope: "agent", content: "x", createdAt: "", updatedAt: "" }] as never);
    expect((await asMember(() => PUT(put({ action: "create", scope: "agent", content: "x" })))).status).toBe(403);
    expect((await asMember(() => PUT(put({ action: "update", id: "a1", content: "y" })))).status).toBe(403);
    expect((await asMember(() => PUT(put({ action: "delete", id: "a1" })))).status).toBe(403);
    expect(insertEntry).not.toHaveBeenCalled();
    expect(updateEntry).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("still lets a member write their own memory", async () => {
    const response = await asMember(() => PUT(put({ action: "create", scope: "user", content: "I prefer pt-BR" })));
    expect(response.status).toBe(200);
    expect(insertEntry).toHaveBeenCalledOnce();
  });
});
