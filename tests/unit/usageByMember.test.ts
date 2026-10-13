import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({
    all: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("neon_auth")) return [{ id: "m-1", name: "Ana", email: "ana@x.com" }];
      return [
        { member: "m-1", model: "gpt-5", provider: "cx", requests: "3", prompttokens: "30", completiontokens: "9", spent: 0.5, lastused: "2026-10-10T00:00:00Z" },
        { member: "gone", model: "gpt-5", provider: "cx", requests: "1", prompttokens: "1", completiontokens: "1", spent: 0.1, lastused: "2026-10-09T00:00:00Z" },
      ];
    }),
  })),
}));

import { withTenant } from "@/lib/db/tenant";
import { periodCutoff, usageByMember } from "@/lib/db/repos/usageByMemberRepo";

describe("usage by member", () => {
  it("cuts the period the way the other usage views do", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(periodCutoff("7d", now)).toBe("2026-10-06T12:00:00.000Z");
    expect(periodCutoff("all", now)).toBeNull();
  });

  it("groups by member and model, counting pre-member rows as the owner's, and names members", async () => {
    const usage = await withTenant("org-1", () => usageByMember("30d"));
    expect(calls[0]!.sql).toContain("COALESCE(actorUserId, userId) AS member");
    expect(calls[0]!.params[0]).toBe("org-1");
    expect(usage["m-1|gpt-5|cx"]).toMatchObject({ memberName: "Ana (ana@x.com)", requests: 3, cost: 0.5 });
    // Someone no longer in Neon Auth still shows, by a short id.
    expect(usage["gone|gpt-5|cx"]!.memberName).toBe("gone");
  });
});
