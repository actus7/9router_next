import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));

const revokeApiKeysForSink = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({ revokeApiKeysForSink }));

import { NextRequest } from "next/server";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

/**
 * Un-configuring a CLI tool and revoking its key are one operation from the
 * operator's side: the key exists only because that tool's config file on disk
 * needed one. Leaving it live after a reset would put a usable credential in the
 * inventory with nothing pointing at it — the state per-destination keys exist
 * to prevent.
 *
 * The revocation lives in the shared handler factory, so all 18 tool routes get
 * it from one place rather than 18 copies that can drift.
 */
beforeEach(() => vi.clearAllMocks());

function request(): NextRequest {
  return new NextRequest("http://localhost/api/cli-tools/claude-settings", { method: "DELETE" });
}

describe("cli tool config reset", () => {
  it("revokes the key issued for that tool", async () => {
    const handlers = createCliToolHandlers("claude", {
      delete: async () => ({ success: true }),
    });

    const response = await handlers.DELETE(request());

    expect(response.status).toBe(200);
    expect(revokeApiKeysForSink).toHaveBeenCalledWith("cli:claude");
  });

  it("scopes revocation to the tool being reset", async () => {
    const handlers = createCliToolHandlers("codex", {
      delete: async () => ({ success: true }),
    });

    await handlers.DELETE(request());

    // Resetting one tool must not touch another tool's key.
    expect(revokeApiKeysForSink).toHaveBeenCalledWith("cli:codex");
    expect(revokeApiKeysForSink).toHaveBeenCalledTimes(1);
  });

  it("still resets the config when revocation fails", async () => {
    revokeApiKeysForSink.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = createCliToolHandlers("claude", {
      delete: async () => ({ success: true }),
    });

    const response = await handlers.DELETE(request());

    // The config file is already rewritten by the time revocation runs, so
    // failing the request on a bookkeeping error would leave the worse state.
    expect(response.status).toBe(200);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not revoke anything when the tool has no delete handler", async () => {
    const handlers = createCliToolHandlers("claude", {});

    const response = await handlers.DELETE(request());

    expect(response.status).toBe(405);
    expect(revokeApiKeysForSink).not.toHaveBeenCalled();
  });
});
