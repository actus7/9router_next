import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const get = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => undefined as Record<string, unknown> | undefined),
);
vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, all: vi.fn(() => []), transaction: (fn: () => unknown) => fn() })),
}));
const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => settings.value) }));
const tenant = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member", actor: "u1" }));
vi.mock("@/lib/db/tenant", () => ({
  currentTenantId: () => "u1",
  currentActorUserId: () => tenant.actor,
  currentTenantContext: () => ({ tenantId: "u1", actorUserId: tenant.actor, role: tenant.role }),
}));

import { createApiKey, deleteApiKey, getApiKeys, getApiKeyProfile, updateApiKeyProfile } from "@/lib/db/repos/apiKeysRepo";
import { GET, PUT } from "@/server/application/use-cases/http/keys/[id]/profile/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue(undefined);
  settings.value = {};
  tenant.role = "owner";
  tenant.actor = "u1";
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("API key profiles", () => {
  it("a new key starts from the account's current flags, written out", async () => {
    settings.value = { cavemanEnabled: true, cavemanLevel: "ultra" };
    await createApiKey("k", "machine-1");
    const insert = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO apiKeys"))!;
    // The last two params are the profile and the member who created the key.
    expect(insert[1]!.at(-1)).toBe("u1");
    const stored = JSON.parse(String(insert[1]!.at(-2)));
    expect(stored.abilities.caveman).toEqual({ enabled: true, level: "ultra" });
    expect(stored.skillIds).toEqual([]);
  });

  it("a key never edited reads as the account's settings", async () => {
    settings.value = { ponytailEnabled: true, neutralityEnabled: true };
    get.mockReturnValue({ profile: null });
    const profile = (await getApiKeyProfile("k1"))!;
    expect(profile.abilities.ponytail.enabled).toBe(true);
    expect(profile.abilities.neutrality.enabled).toBe(true);
  });

  it("an update merges over the current profile and is tenant-scoped", async () => {
    get.mockReturnValue({ profile: JSON.stringify({ abilities: { rtk: false }, skillIds: ["tdd"] }) });
    const next = await updateApiKeyProfile("k1", { abilities: { caveman: { enabled: true } } });
    expect(next?.abilities.rtk).toBe(false);
    expect(next?.abilities.caveman.enabled).toBe(true);
    expect(next?.skillIds).toEqual(["tdd"]);
    const update = run.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE apiKeys SET profile"))!;
    expect(String(update[0])).toContain("WHERE userId = ? AND id = ?");
    expect(update[1]!.slice(1)).toEqual(["u1", "k1"]);
  });

  it("the route answers 404 for a key this account does not own", async () => {
    get.mockReturnValue(undefined);
    expect((await GET(new NextRequest("http://x/api/keys/other/profile"), ctx("other"))).status).toBe(404);
    const put = await PUT(
      new NextRequest("http://x/api/keys/other/profile", { method: "PUT", body: JSON.stringify({ skillIds: [] }) }),
      ctx("other"),
    );
    expect(put.status).toBe(404);
  });

  it("the route rejects a body that is not an object", async () => {
    const put = await PUT(
      new NextRequest("http://x/api/keys/k1/profile", { method: "PUT", body: "[]" }),
      ctx("k1"),
    );
    expect(put.status).toBe(400);
  });

  it("a member lists and deletes only the keys they created", async () => {
    tenant.role = "member";
    tenant.actor = "m7";
    const all = vi.fn((_sql: string, _params?: unknown[]) => []);
    const { getAdapter } = await import("@/lib/db/driver");
    vi.mocked(getAdapter).mockResolvedValueOnce({ run, get, all, transaction: (fn: () => unknown) => fn() } as never);
    await getApiKeys();
    expect(all.mock.calls[0]![0]).toContain("COALESCE(ownerUserId, userId) = ?");
    expect(all.mock.calls[0]![1]).toEqual(["u1", "m7"]);

    await deleteApiKey("k9");
    const del = run.mock.calls.find(([sql]) => String(sql).startsWith("DELETE FROM apiKeys"))!;
    expect(del[1]).toEqual(["u1", "m7", "k9"]);
  });

  it("deleting a key drops its access policy with it", async () => {
    await deleteApiKey("k9");
    const policy = run.mock.calls.find(([sql]) => String(sql).includes("DELETE FROM accessPolicies"));
    expect(policy?.[1]).toEqual(["u1", "k9"]);
  });
});
