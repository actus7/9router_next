import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUsageStats } = vi.hoisted(() => ({
  getUsageStats: vi.fn(async () => ({ byProvider: { openrouter: { requests: 5 }, groq: { requests: 9 } } })),
}));

vi.mock("@/lib/db/repos/usageRepo", () => ({ getUsageStats }));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: vi.fn(async () => {}) }));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => [
    { id: "c1", provider: "codex", authType: "oauth", isActive: true },
    { id: "c2", provider: "openrouter", authType: "apikey", isActive: true },
  ]),
}));

import { GET } from "@/server/application/use-cases/http/providers/client/route";

describe("quota page connection list", () => {
  it("lists only connections whose quota can be tracked, without scanning usage history", async () => {
    const res = await GET(new NextRequest("http://localhost/api/providers/client"));
    const body = await res.json();

    expect(body.connections.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    expect(body.providerOptions).toEqual(["codex"]);
    expect(getUsageStats).not.toHaveBeenCalled();
  });
});
