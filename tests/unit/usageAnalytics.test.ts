import { beforeEach, describe, expect, it, vi } from "vitest";

interface HistoryRow {
  id?: number;
  timestamp: string;
  provider: string;
  model: string;
  connectionId?: string;
  apiKey?: string | null;
  endpoint?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  tokens?: string;
  status?: string;
}

interface DailyRow {
  dateKey: string;
  data: string;
}

function createMockDb(history: HistoryRow[], daily: DailyRow[] = []) {
  return {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn((sql: string, params?: unknown[]) => {
      const query = sql.replace(/\s+/g, " ").trim().toLowerCase();

      if (query.startsWith("select timestamp, provider, model, tokens, status from usagehistory order by id desc limit 100")) {
        return [...history].reverse().slice(0, 100);
      }

      if (query.startsWith("select timestamp, prompttokens, completiontokens, cost from usagehistory where timestamp >=")) {
        const [from, to] = (params || []) as string[];
        return history.filter((row) => row.timestamp >= from && row.timestamp <= to);
      }

      if (query.startsWith("select timestamp, provider, model, connectionid, apikey, endpoint, prompttokens, completiontokens, cost, tokens from usagehistory where timestamp >=")) {
        const [from] = (params || []) as string[];
        return history.filter((row) => row.timestamp >= from);
      }

      if (query.startsWith("select timestamp, provider, model, connectionid, apikey, endpoint from usagehistory where timestamp >=")) {
        const [from] = (params || []) as string[];
        return history.filter((row) => row.timestamp >= from);
      }

      if (query.startsWith("select timestamp, prompttokens, completiontokens, cost from usagehistory where timestamp >=") && query.includes("limit") === false) {
        const [from] = (params || []) as string[];
        return history.filter((row) => row.timestamp >= from);
      }

      if (query.startsWith("select datekey, data from usagedaily where datekey >=")) {
        const [cutoff] = (params || []) as string[];
        return daily.filter((row) => row.dateKey >= cutoff);
      }

      if (query === "select datekey, data from usagedaily") {
        return daily;
      }

      return [];
    }),
  };
}

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(() => Promise.resolve([
    { id: "conn-1", name: "Main Account", email: null },
  ])),
}));

vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  getApiKeys: vi.fn(() => Promise.resolve([
    { key: "sk-testkey1234567890", name: "Dev Key", id: "key-1", createdAt: "2026-01-01T00:00:00.000Z" },
  ])),
}));

vi.mock("@/lib/db/repos/nodesRepo", () => ({
  getProviderNodes: vi.fn(() => Promise.resolve([
    { id: "openai", name: "OpenAI" },
  ])),
}));

import { getAdapter } from "@/lib/db/driver";
import { getChartData, getUsageStatsForState } from "@/lib/db/repos/usageAnalytics";

describe("usageAnalytics", () => {
  const recentIso = "2026-09-02T12:00:00.000Z";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates 24h usage from history rows", async () => {
    vi.mocked(getAdapter).mockResolvedValue(createMockDb([
      {
        id: 1,
        timestamp: recentIso,
        provider: "openai",
        model: "gpt-4o",
        connectionId: "conn-1",
        apiKey: "sk-testkey1234567890",
        endpoint: "/v1/chat/completions",
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.25,
        tokens: JSON.stringify({ prompt_tokens: 100, completion_tokens: 50 }),
        status: "ok",
      },
    ]) as never);

    const stats = await getUsageStatsForState("24h", {
      pendingRequests: { byModel: {}, byAccount: {} },
      lastErrorProvider: { provider: "", ts: 0 },
    });

    expect(stats.totalPromptTokens).toBe(100);
    expect(stats.totalCompletionTokens).toBe(50);
    expect(stats.totalCost).toBe(0.25);
    expect(stats.byProvider.openai.requests).toBe(1);
    expect(stats.byModel["gpt-4o (openai)"].requests).toBe(1);
    expect(stats.byAccount["gpt-4o (openai - Main Account)"].accountName).toBe("Main Account");
    expect(stats.byApiKey["sk-testk***|gpt-4o|openai"].keyName).toBe("Dev Key");
    expect(stats.byEndpoint["/v1/chat/completions|gpt-4o|openai"].endpoint).toBe("/v1/chat/completions");
    expect(stats.totalRequests).toBe(1);
  });

  it("builds active requests from pending account state", async () => {
    vi.mocked(getAdapter).mockResolvedValue(createMockDb([]) as never);

    const stats = await getUsageStatsForState("24h", {
      pendingRequests: {
        byModel: {},
        byAccount: {
          "conn-1": {
            "gpt-4o (openai)": 2,
          },
        },
      },
      lastErrorProvider: { provider: "", ts: 0 },
    });

    expect(stats.activeRequests).toEqual([
      {
        model: "gpt-4o",
        provider: "openai",
        account: "Main Account",
        count: 2,
      },
    ]);
  });

  it("exposes recent provider error for 10 seconds", async () => {
    vi.mocked(getAdapter).mockResolvedValue(createMockDb([]) as never);

    const stats = await getUsageStatsForState("24h", {
      pendingRequests: { byModel: {}, byAccount: {} },
      lastErrorProvider: { provider: "openai", ts: Date.now() - 1000 },
    });

    expect(stats.errorProvider).toBe("openai");
  });

  it("aggregates daily summary for 7d period", async () => {
    vi.mocked(getAdapter).mockResolvedValue(createMockDb([], [
      {
        dateKey: "2026-09-02",
        data: JSON.stringify({
          requests: 3,
          promptTokens: 300,
          completionTokens: 150,
          cachedTokens: 20,
          cost: 1.5,
          byProvider: {
            openai: { requests: 3, promptTokens: 300, completionTokens: 150, cachedTokens: 20, cost: 1.5 },
          },
          byModel: {
            "gpt-4o|openai": {
              requests: 3,
              promptTokens: 300,
              completionTokens: 150,
              cachedTokens: 20,
              cost: 1.5,
              rawModel: "gpt-4o",
              provider: "openai",
            },
          },
          byAccount: {},
          byApiKey: {},
          byEndpoint: {},
        }),
      },
    ]) as never);

    const stats = await getUsageStatsForState("7d", {
      pendingRequests: { byModel: {}, byAccount: {} },
      lastErrorProvider: { provider: "", ts: 0 },
    });

    expect(stats.totalPromptTokens).toBe(300);
    expect(stats.totalCompletionTokens).toBe(150);
    expect(stats.totalCachedTokens).toBe(20);
    expect(stats.totalCost).toBe(1.5);
    expect(stats.byProvider.openai.requests).toBe(3);
    expect(stats.byModel["gpt-4o (openai)"].provider).toBe("OpenAI");
  });

  it("builds chart buckets from daily summary for 7d", async () => {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    vi.mocked(getAdapter).mockResolvedValue(createMockDb([], [
      {
        dateKey,
        data: JSON.stringify({
          promptTokens: 120,
          completionTokens: 80,
          cost: 0.4,
        }),
      },
    ]) as never);

    const buckets = await getChartData("7d");
    expect(buckets).toHaveLength(7);
    const todayBucket = buckets.at(-1);
    expect(todayBucket?.tokens).toBe(200);
    expect(todayBucket?.cost).toBe(0.4);
    expect(todayBucket?.label).toBeTruthy();
  });
});
