import { beforeEach, describe, expect, it, vi } from "vitest";

const all = vi.fn();
const get = vi.fn();

vi.mock("@/lib/db/driver", () => ({ getAdapter: async () => ({ all, get }) }));
vi.mock("@/lib/db/tenant", () => ({ currentTenantId: () => "tenant-1" }));

import { getUsageFilterOptions, listUsageRequests } from "@/lib/db/repos/usageRequestsRepo";
import { MODELHUB_PROVIDER } from "@/shared/usage/requestFilters";
import { buildRequestsQuery } from "@/app/(dashboard)/dashboard/usage/components/requests/requestFormat";
import { EMPTY_FILTERS } from "@/app/(dashboard)/dashboard/usage/components/requests/types";

beforeEach(() => {
  all.mockReset().mockResolvedValue([]);
  get.mockReset().mockResolvedValue({ c: 0 });
});

describe("requests list: ModelHub and API key filters", () => {
  it("maps the ModelHub provider to 'resolved through a combo', not to a provider column match", async () => {
    await listUsageRequests({ provider: MODELHUB_PROVIDER, page: 1, pageSize: 20 });
    const sql = String(get.mock.calls[0][0]);
    expect(sql).toContain("{routing,combo}");
    expect(sql).not.toContain("provider = ?");
    expect(get.mock.calls[0][1]).toEqual(["tenant-1"]);
  });

  it("still filters a real provider by column", async () => {
    await listUsageRequests({ provider: "kilo-gateway", page: 1, pageSize: 20 });
    expect(String(get.mock.calls[0][0])).toContain("provider = ?");
    expect(get.mock.calls[0][1]).toEqual(["tenant-1", "kilo-gateway"]);
  });

  it("filters by API key id", async () => {
    await listUsageRequests({ apiKey: "key-1", page: 1, pageSize: 20 });
    expect(String(get.mock.calls[0][0])).toContain("apiKey = ?");
    expect(get.mock.calls[0][1]).toEqual(["tenant-1", "key-1"]);
  });

  it("lists the account's keys with their names as filter options", async () => {
    all
      .mockResolvedValueOnce([{ provider: "kilo-gateway" }])
      .mockResolvedValueOnce([{ model: "m" }])
      .mockResolvedValueOnce([{ id: "key-1", name: "Meu app" }, { id: "key-2", name: null }]);
    const options = await getUsageFilterOptions();
    expect(options.apiKeys).toEqual([
      { id: "key-1", name: "Meu app" },
      { id: "key-2", name: null },
    ]);
  });
});

describe("requests query: apiKey", () => {
  it("sends the key id when set", () => {
    expect(buildRequestsQuery({ ...EMPTY_FILTERS, apiKey: "key-1" }, 1, 20)).toContain("apiKey=key-1");
  });

  it("omits it when empty", () => {
    expect(buildRequestsQuery(EMPTY_FILTERS, 1, 20)).not.toContain("apiKey");
  });
});
