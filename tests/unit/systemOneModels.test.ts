import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getJevApiKey = vi.fn();
vi.mock("@/server/decisions/jev", () => ({ JEV_MODEL: "typesafe-ai/jev", getJevApiKey: () => getJevApiKey() }));

import { listSystemOneModels, parseSystemOneModels } from "@/server/decisions/systemOneModels";

describe("parseSystemOneModels", () => {
  it("reads an OpenAI-style { data: [...] } list of objects", () => {
    expect(parseSystemOneModels({ data: [{ id: "typesafe-ai/jev", name: "Jev", description: "Decisions" }] })).toEqual([
      { id: "typesafe-ai/jev", name: "Jev", description: "Decisions" },
    ]);
  });

  it("reads a bare array of ids and names models after the id when none is given", () => {
    expect(parseSystemOneModels(["typesafe-ai/laya"])).toEqual([{ id: "typesafe-ai/laya", name: "laya", description: null }]);
  });

  it("reads { models: [...] }", () => {
    expect(parseSystemOneModels({ models: [{ id: "typesafe-ai/jev" }] })).toHaveLength(1);
  });

  it("namespaces a bare id and drops entries without one", () => {
    expect(parseSystemOneModels({ data: [{ id: "jev" }, { name: "no id" }, null, 7] }).map((m) => m.id)).toEqual(["typesafe-ai/jev"]);
  });

  it("returns an empty list for anything unrecognised", () => {
    expect(parseSystemOneModels(null)).toEqual([]);
    expect(parseSystemOneModels({ error: "nope" })).toEqual([]);
  });
});

describe("listSystemOneModels", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    getJevApiKey.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists what the gateway reports, authenticated with the account's key", async () => {
    getJevApiKey.mockResolvedValue("vck_key");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "typesafe-ai/jev" }, { id: "typesafe-ai/laya" }] })));
    const result = await listSystemOneModels();
    expect(result.source).toBe("gateway");
    expect(result.models.map((m) => m.id)).toEqual(["typesafe-ai/jev", "typesafe-ai/laya"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ai-gateway.vercel.sh/typesafe/v1/models");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer vck_key" });
  });

  it("without a key, shows Jev only and says why", async () => {
    getJevApiKey.mockResolvedValue(null);
    const result = await listSystemOneModels();
    expect(result).toMatchObject({ source: "builtin", error: "no_key" });
    expect(result.models.map((m) => m.id)).toEqual(["typesafe-ai/jev"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Jev when the gateway fails, without leaking the key", async () => {
    getJevApiKey.mockResolvedValue("vck_secret");
    fetchMock.mockResolvedValue(new Response("boom vck_secret", { status: 500 }));
    const result = await listSystemOneModels();
    expect(result).toMatchObject({ source: "builtin", error: "http" });
    expect(JSON.stringify(result)).not.toContain("vck_secret");
  });

  it("falls back when the gateway answers an empty list", async () => {
    getJevApiKey.mockResolvedValue("vck_key");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    expect((await listSystemOneModels()).source).toBe("builtin");
  });

  it("falls back when the request throws", async () => {
    getJevApiKey.mockResolvedValue("vck_key");
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await listSystemOneModels()).toMatchObject({ source: "builtin", error: "network" });
  });
});
