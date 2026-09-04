import { beforeEach, describe, expect, it, vi } from "vitest";

// These suites cover route logic, not the auth gate; tests/unit/dashboardAccess.test.ts
// and tests/unit/harnessRouteAuth.test.ts cover the gate itself.
vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));

vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));
vi.mock("@/server/harness/skills/skillLibrarySearch", () => ({
  searchSkillLibrary: vi.fn(async () => ({
    query: "tdd",
    libraryId: "all",
    skills: [
      {
        id: "obra/superpowers/test-driven-development",
        skillId: "test-driven-development",
        name: "test-driven-development",
        source: "obra/superpowers",
        installs: 100,
      },
    ],
  })),
}));
vi.mock("@/server/harness/skills/installSkillFromLibrary", () => ({
  installSkillFromLibrary: vi.fn(async () => ({
    ok: true as const,
    skillId: "test-driven-development",
    url: "https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md",
  })),
}));
vi.mock("@/server/harness/skills/context", () => ({
  reloadSkillTree: vi.fn(async () => ({
    revision: 1,
    skills: [{ id: "test-driven-development" }],
    diagnostics: [],
  })),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "@/server/application/use-cases/http/harness/skills/library/route";
import { installSkillFromLibrary } from "@/server/harness/skills/installSkillFromLibrary";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/harness/skills/library", () => {
  it("returns libraries and search results", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/harness/skills/library?q=tdd"),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.libraries.length).toBeGreaterThan(0);
    expect(payload.skills[0].skillId).toBe("test-driven-development");
  });
});

describe("POST /api/harness/skills/library", () => {
  it("installs a skill from source", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/harness/skills/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "obra/superpowers",
          skillId: "test-driven-development",
        }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(installSkillFromLibrary).toHaveBeenCalledOnce();
    expect(payload.installedId).toBe("test-driven-development");
  });

  it("rejects missing fields", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/harness/skills/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "obra/superpowers" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
