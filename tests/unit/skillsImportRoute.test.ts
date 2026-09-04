import { describe, expect, it, vi } from "vitest";

// These suites cover route logic, not the auth gate; tests/unit/dashboardAccess.test.ts
// and tests/unit/harnessRouteAuth.test.ts cover the gate itself.
vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));

vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));

import { NextRequest } from "next/server";
import { POST } from "@/server/application/use-cases/http/harness/skills/import/route";

describe("POST /api/harness/skills/import", () => {
  it("rejects non-HTTPS URLs", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/harness/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://example.com/skill.md" }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/HTTPS/i);
  });

  it("rejects blocked internal hosts", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/harness/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://127.0.0.1/skill.md" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
