import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));
vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));

const upsertAgentSkillRow = vi.hoisted(() => vi.fn(async () => {}));
const replaceAgentSkillFiles = vi.hoisted(() => vi.fn(async () => {}));
const insertHarnessPendingWrite = vi.hoisted(() =>
  vi.fn(async (write: Record<string, unknown>) => ({ ...write, status: "pending", createdAt: "now" })),
);
const getHarnessLearningConfig = vi.hoisted(() =>
  vi.fn(async () => ({ skillWriteApproval: true })),
);

vi.mock("@/lib/db/repos/agentSkillsRepo", () => ({
  upsertAgentSkillRow,
  deleteAgentSkillWithFiles: vi.fn(),
  listAgentSkillRows: vi.fn(async () => []),
  getAgentSkillsRevision: vi.fn(async () => 0),
}));
vi.mock("@/lib/db/repos/agentSkillFilesRepo", () => ({
  replaceAgentSkillFiles,
  isValidSkillFilePath: vi.fn(() => true),
  listAgentSkillFiles: vi.fn(async () => []),
  deleteAgentSkillFilesForSkill: vi.fn(),
}));
vi.mock("@/lib/db/repos/harnessPendingWritesRepo", () => ({ insertHarnessPendingWrite }));
vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({ getHarnessLearningConfig }));

import { NextRequest } from "next/server";
import { PUT } from "@/server/application/use-cases/http/harness/skills/route";

const url = "http://localhost/api/harness/skills";

function put(body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SKILL = {
  id: "my-skill",
  name: "my-skill",
  description: "A skill",
  body: "# do the thing",
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getHarnessLearningConfig.mockResolvedValue({ skillWriteApproval: true });
});

/**
 * A skill is a standing instruction that re-enters the system prompt of every
 * later run — strictly more powerful than a memory entry, which is already
 * gated, and than a plugin toggle, which is always gated. Agent-initiated
 * skill writes went straight to the database, which left the governance model
 * covering two of the three persistent write paths.
 */
describe("agent-initiated skill writes", () => {
  it("queues for approval instead of writing the skill", async () => {
    const response = await PUT(put({ ...SKILL, initiator: "agent", action: "create" }));
    const payload = await response.json();

    expect(payload.pending).toBe(true);
    expect(payload.pendingId).toBeTruthy();

    // The point of the gate: nothing reached the skill tables.
    expect(upsertAgentSkillRow).not.toHaveBeenCalled();
    expect(replaceAgentSkillFiles).not.toHaveBeenCalled();

    const queued = insertHarnessPendingWrite.mock.calls[0]![0] as Record<string, unknown>;
    expect(queued.kind).toBe("skill");
    expect(queued.source).toBe("agent");
    expect(queued.action).toBe("create");
  });

  it("writes directly when the operator turns approval off", async () => {
    getHarnessLearningConfig.mockResolvedValue({ skillWriteApproval: false });

    const response = await PUT(put({ ...SKILL, initiator: "agent" }));

    expect(response.status).toBe(200);
    expect(insertHarnessPendingWrite).not.toHaveBeenCalled();
    expect(upsertAgentSkillRow).toHaveBeenCalledTimes(1);
  });
});

describe("operator-initiated skill writes", () => {
  it("are never gated, because the operator is the authority", async () => {
    const response = await PUT(put(SKILL));

    expect(response.status).toBe(200);
    expect(insertHarnessPendingWrite).not.toHaveBeenCalled();
    expect(upsertAgentSkillRow).toHaveBeenCalledTimes(1);
  });

  it("stay ungated even with approval on", async () => {
    getHarnessLearningConfig.mockResolvedValue({ skillWriteApproval: true });

    await PUT(put({ ...SKILL, initiator: "user" }));

    expect(insertHarnessPendingWrite).not.toHaveBeenCalled();
    expect(upsertAgentSkillRow).toHaveBeenCalledTimes(1);
  });
});
