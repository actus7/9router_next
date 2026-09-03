import { beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers mark themselves request-time dynamic, and Next's connection()
// throws when called outside a request scope, which is where a unit test lives.
vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/repos/pluginRowsRepo", () => ({
  upsertPluginRow: vi.fn(),
  deletePluginRow: vi.fn(),
}));
vi.mock("@/server/plugin-core/context", () => ({
  bootstrap: vi.fn(async () => ({}) as never),
  getPluginTreeState: vi.fn(() => ({ revision: 3, rows: [], diagnostics: [] })),
  reloadPluginTree: vi.fn(async () => ({ revision: 4, rows: [], diagnostics: [] })),
}));

import { NextRequest } from "next/server";
import { DELETE, GET, PUT } from "@/server/application/use-cases/http/harness/plugins/route";
import { deletePluginRow, upsertPluginRow } from "@/lib/db/repos/pluginRowsRepo";
import { reloadPluginTree } from "@/server/plugin-core/context";

const url = "http://localhost/api/harness/plugins";

function put(body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validCapability = {
  id: "persona",
  plugin: "harness-capability",
  config: {
    id: "persona",
    title: "ModelHub context",
    description: "d",
    module: "builtin:modelhub-context",
    kind: "context",
  },
  enabled: false,
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/harness/plugins", () => {
  it("returns the composed tree with the bundle row ids and the active catalogue", async () => {
    const payload = await (await GET()).json();

    expect(payload.revision).toBe(3);
    expect(payload.bundleRowIds).toContain("persona");
    expect(payload.catalog.plugins.length).toBeGreaterThan(0);
  });
});

describe("PUT /api/harness/plugins", () => {
  it("stores a valid row and answers with the recomposed tree", async () => {
    const response = await PUT(put(validCapability));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(upsertPluginRow).toHaveBeenCalledOnce();
    expect(reloadPluginTree).toHaveBeenCalledOnce();
    expect(payload.revision).toBe(4);
  });

  it("infers override for an id the bundle declares", async () => {
    await PUT(put(validCapability));

    expect(vi.mocked(upsertPluginRow).mock.calls[0]![0]).toMatchObject({
      id: "persona",
      source: "override",
      enabled: false,
    });
  });

  it("infers user for an id the bundle does not declare", async () => {
    await PUT(
      put({
        ...validCapability,
        id: "my-own-context",
        config: { ...validCapability.config, id: "my-own-context" },
      }),
    );

    expect(vi.mocked(upsertPluginRow).mock.calls[0]![0]).toMatchObject({
      id: "my-own-context",
      source: "user",
    });
  });

  // The route applies the same rules composition would, so an invalid row is
  // refused at the boundary instead of being stored and quietly ignored later.
  it("rejects an unknown factory without writing", async () => {
    const response = await PUT(put({ ...validCapability, plugin: "nope" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unknown plugin factory: nope" });
    expect(upsertPluginRow).not.toHaveBeenCalled();
  });

  it("rejects a config the factory refuses", async () => {
    const response = await PUT(put({ ...validCapability, config: { id: "persona" } }));

    expect(response.status).toBe(400);
    expect(upsertPluginRow).not.toHaveBeenCalled();
  });

  it("rejects a tool the runtime cannot execute", async () => {
    const response = await PUT(
      put({
        id: "tool-minesweeper",
        plugin: "harness-capability",
        config: {
          id: "tool-minesweeper",
          title: "Minesweeper",
          description: "d",
          module: "db:minesweeper",
          kind: "tool",
          tool: {
            type: "function",
            function: { name: "minesweeper_board", description: "d", parameters: {} },
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("no runtime implementation");
  });

  it("rejects an explicit override that targets no bundle row", async () => {
    const response = await PUT(
      put({
        ...validCapability,
        id: "ghost",
        config: { ...validCapability.config, id: "ghost" },
        source: "override",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "override targets no bundle row" });
  });

  it("rejects a body with no id", async () => {
    const response = await PUT(put({ plugin: "harness-capability", config: {} }));

    expect(response.status).toBe(400);
    expect(upsertPluginRow).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/harness/plugins", () => {
  it("drops the stored row and recomposes", async () => {
    const response = await DELETE(new NextRequest(`${url}?id=persona`, { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(deletePluginRow).toHaveBeenCalledWith("persona");
    expect(reloadPluginTree).toHaveBeenCalledOnce();
  });

  it("requires an id", async () => {
    const response = await DELETE(new NextRequest(url, { method: "DELETE" }));

    expect(response.status).toBe(400);
    expect(deletePluginRow).not.toHaveBeenCalled();
  });
});
