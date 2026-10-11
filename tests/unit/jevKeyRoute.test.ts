import { beforeEach, describe, expect, it, vi } from "vitest";

const probeJev = vi.hoisted(() => vi.fn());
const repo = vi.hoisted(() => ({
  hasTypesafeKey: vi.fn(async () => false),
  saveTypesafeKey: vi.fn(async () => {}),
  removeTypesafeKey: vi.fn(async () => {}),
}));
vi.mock("@/server/decisions/jev", () => ({ probeJev }));
vi.mock("@/lib/db/repos/decisionKeysRepo", () => repo);

import { DELETE, GET, PUT } from "@/server/application/use-cases/http/decisions/jevKey";

const put = (body: unknown) => PUT(new Request("http://x/api/decisions/jev/key", { method: "PUT", body: JSON.stringify(body) }));

describe("TypeSafe key on the account", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says whether a key is saved, never the key itself", async () => {
    repo.hasTypesafeKey.mockResolvedValueOnce(true);
    expect(await (await GET()).json()).toEqual({ typesafe: true });
  });

  it("tries the key against TypeSafe before saving it", async () => {
    probeJev.mockResolvedValueOnce({ ok: true, latencyMs: 120 });
    const res = await put({ apiKey: "  ts_live  " });
    expect(res.status).toBe(200);
    expect(probeJev).toHaveBeenCalledWith(expect.any(Number), { typesafeKey: "ts_live" });
    expect(repo.saveTypesafeKey).toHaveBeenCalledWith("ts_live");
  });

  it("refuses a key TypeSafe rejects, and saves nothing", async () => {
    probeJev.mockResolvedValueOnce({ ok: false, reason: "unauthorized", status: 401, message: "bad key" });
    const res = await put({ apiKey: "ts_bad" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "unauthorized" });
    expect(repo.saveTypesafeKey).not.toHaveBeenCalled();
  });

  it("rejects an empty body", async () => {
    expect((await put({})).status).toBe(400);
    expect(probeJev).not.toHaveBeenCalled();
  });

  it("removes the key", async () => {
    expect((await DELETE()).status).toBe(200);
    expect(repo.removeTypesafeKey).toHaveBeenCalled();
  });
});
