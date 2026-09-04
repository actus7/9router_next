import { beforeEach, describe, expect, it, vi } from "vitest";

// These suites cover route logic, not the auth gate; tests/unit/dashboardAccess.test.ts
// and tests/unit/harnessRouteAuth.test.ts cover the gate itself.
vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));

vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/repos/agentSkillsRepo", () => ({
  upsertAgentSkillRow: vi.fn(),
  deleteAgentSkillWithFiles: vi.fn(),
  listAgentSkillRows: vi.fn(async () => []),
  getAgentSkillsRevision: vi.fn(async () => 0),
}));

import { NextRequest } from "next/server";
import { GET, PUT, DELETE } from "@/server/application/use-cases/http/harness/skills/route";
import { upsertAgentSkillRow, deleteAgentSkillWithFiles } from "@/lib/db/repos/agentSkillsRepo";

const url = "http://localhost/api/harness/skills";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/harness/skills", () => {
  it("returns bundled skill-creator in catalog", async () => {
    const payload = await (await GET(new NextRequest(url))).json();
    expect(payload.skills.some((s: { id: string }) => s.id === "skill-creator")).toBe(
      true,
    );
    expect(payload.bundleSkillIds).toContain("skill-creator");
  });

  it("returns single skill by id", async () => {
    const response = await GET(
      new NextRequest(`${url}?id=skill-creator`),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.skill.id).toBe("skill-creator");
    expect(payload.skill.body).toContain("Skill Creator");
  });
});

describe("PUT /api/harness/skills", () => {
  it("creates a user skill", async () => {
    const response = await PUT(
      new NextRequest(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "my-skill",
          name: "my-skill",
          description: "Does things",
          body: "Steps",
          enabled: true,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(upsertAgentSkillRow).toHaveBeenCalledOnce();
  });

  it("rejects invalid slug", async () => {
    const response = await PUT(
      new NextRequest(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "Bad_Slug",
          description: "x",
          body: "y",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/harness/skills", () => {
  // The row and its auxiliary files go together in one transaction — two
  // separate repo calls left a skill listed whose files had already vanished.
  it("deletes the override row and its files by id", async () => {
    const response = await DELETE(
      new NextRequest(`${url}?id=skill-creator`),
    );
    expect(response.status).toBe(200);
    expect(deleteAgentSkillWithFiles).toHaveBeenCalledWith("skill-creator");
  });
});
