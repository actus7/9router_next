import { describe, expect, it, vi } from "vitest";

const importDb = vi.fn(async () => ({}));
vi.mock("@/lib/db/index", () => ({ importDb, exportDb: async () => ({}) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: async () => ({}) }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: () => {} }));

const { POST } = await import("@/server/application/use-cases/http/settings/database/route");

function post(body: string): Request {
  return new Request("https://x/api/settings/database", { method: "POST", body });
}

/**
 * The import runs every collection inside one transaction, so an unbounded
 * payload is an OOM plus a Neon transaction held open for its duration. The
 * route had no body cap, no Array.isArray and no element count.
 */
describe("POST /api/settings/database", () => {
  it("refuses a payload past the byte ceiling before parsing it", async () => {
    const huge = JSON.stringify({ apiKeys: [], pad: "x".repeat(9 * 1024 * 1024) });
    const res = await POST(post(huge) as never);
    expect(res.status).toBe(413);
    expect(importDb).not.toHaveBeenCalled();
  });

  it("refuses a collection with too many rows", async () => {
    const rows = Array.from({ length: 5_001 }, (_, i) => ({ id: String(i) }));
    const res = await POST(post(JSON.stringify({ providerConnections: rows })) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("providerConnections") });
    expect(importDb).not.toHaveBeenCalled();
  });

  it("refuses a collection that is not the shape the importer walks", async () => {
    const res = await POST(post(JSON.stringify({ apiKeys: { nope: true } })) as never);
    expect(res.status).toBe(400);
    expect(importDb).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a JSON object", async () => {
    expect((await POST(post("[1,2,3]") as never)).status).toBe(400);
    expect((await POST(post("nao-e-json") as never)).status).toBe(400);
    expect(importDb).not.toHaveBeenCalled();
  });

  it("still accepts a payload of a realistic size", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i), provider: "openai" }));
    const res = await POST(post(JSON.stringify({ providerConnections: rows, settings: { a: 1 } })) as never);
    expect(res.status).toBe(200);
    expect(importDb).toHaveBeenCalledOnce();
  });
});
