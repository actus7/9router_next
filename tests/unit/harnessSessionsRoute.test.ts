import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));

const syncHarnessConversations = vi.hoisted(() => vi.fn(async () => ({ stale: [] as string[] })));

vi.mock("@/lib/db/repos/harnessConversationsRepo", () => ({
  listHarnessConversations: vi.fn(async () => []),
  syncHarnessConversations,
}));

import { NextRequest } from "next/server";
import { PUT } from "@/server/application/use-cases/http/harness/sessions/route";

const url = "http://localhost/api/harness/sessions";

function put(body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const session = {
  id: "s1",
  title: "Kept",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/harness/sessions", () => {
  it("treats a payload with no deletedIds as deleting nothing", async () => {
    // The contract that keeps a stale client harmless — including a tab still
    // running the previous bundle, which sends no `deletedIds` at all.
    const response = await PUT(put({ sessions: [session] }));

    expect(response.status).toBe(200);
    expect(syncHarnessConversations).toHaveBeenCalledWith({ upserts: [session], deletedIds: [] });
  });

  it("passes the named deletions through", async () => {
    await PUT(put({ sessions: [], deletedIds: ["gone", "", 7] }));

    expect(syncHarnessConversations).toHaveBeenCalledWith({ upserts: [], deletedIds: ["gone"] });
  });

  it("tells the client which conversations it refused as stale", async () => {
    syncHarnessConversations.mockResolvedValueOnce({ stale: ["s1"] });

    const payload = await (await PUT(put({ sessions: [session] }))).json();

    expect(payload.stale).toEqual(["s1"]);
  });

  it("bounds the number of deletions in one request", async () => {
    const response = await PUT(put({
      sessions: [],
      deletedIds: Array.from({ length: 501 }, (_, index) => `id-${index}`),
    }));

    expect(response.status).toBe(400);
    expect(syncHarnessConversations).not.toHaveBeenCalled();
  });

  it("rejects a session whose mcpServers point somewhere private", async () => {
    const response = await PUT(put({
      sessions: [{ ...session, mcpServers: [{ url: "http://169.254.169.254/latest/meta-data" }] }],
    }));

    expect(response.status).toBe(400);
    expect(syncHarnessConversations).not.toHaveBeenCalled();
  });
});
