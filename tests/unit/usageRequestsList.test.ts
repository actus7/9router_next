import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The always-on Requests list: one `usageHistory` row per request, addressed by
 * the row id the drawer later sends back as `usageId`. What the UI is written
 * against is the response contract (statusLabel, cache tokens, routing summary,
 * detailId), and the filters must narrow in SQL - these rows paginate.
 */

interface MockDb {
  calls: Array<{ sql: string; params: unknown[] }>;
  run: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
  get: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | undefined>;
  all: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
  exec: (sql: string) => Promise<void>;
  transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

function createDb(
  rows: Array<Record<string, unknown>>,
  opts: {
    total?: number;
    refs?: Array<Record<string, unknown>>;
    providers?: string[];
    models?: string[];
  } = {},
): MockDb {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const record = (sql: string, params?: unknown[]) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params: params ?? [] });
  };
  return {
    calls,
    run: vi.fn(async (sql: string, params?: unknown[]) => {
      record(sql, params);
      return { changes: 1 };
    }),
    get: vi.fn(async (sql: string, params?: unknown[]) => {
      record(sql, params);
      if (/COUNT\(\*\)/i.test(sql)) return { c: opts.total ?? rows.length };
      return undefined;
    }),
    all: vi.fn(async (sql: string, params?: unknown[]) => {
      record(sql, params);
      if (sql.includes("FROM requestDetails")) return opts.refs ?? [];
      if (sql.includes("SELECT DISTINCT provider")) return (opts.providers ?? []).map((provider) => ({ provider }));
      if (sql.includes("SELECT DISTINCT model")) return (opts.models ?? []).map((model) => ({ model }));
      return rows;
    }),
    exec: vi.fn(async () => {}),
    transaction: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    close: async () => {},
  };
}

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/server/application/http/tenantRoute", async () => (await import("../setup/routeWrappers")).routeWrapperMocks);
vi.mock("@/server/application/http/requestRuntime", () => ({ assertRequestRuntime: vi.fn(async () => {}) }));
vi.mock("@/lib/db/driver", () => ({ getAdapter: vi.fn(async () => state.db) }));

import { GET } from "@/app/api/usage/requests/route";

function install(db: MockDb): MockDb {
  state.db = db;
  return db;
}

function request(query = ""): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/usage/requests${query}`)) as unknown as Promise<Response>;
}

function usageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123,
    timestamp: "2026-10-01T10:00:00.000Z",
    provider: "openai",
    model: "gpt-4.1",
    connectionId: "conn-1",
    endpoint: "/v1/chat/completions",
    promptTokens: 10,
    completionTokens: 5,
    cost: 0.01,
    status: "ok",
    tokens: JSON.stringify({ prompt_tokens: 10, completion_tokens: 5, cached_tokens: 3, cache_creation_input_tokens: 1 }),
    meta: JSON.stringify({
      routing: { requested: "gpt-4.1", selected: "gpt-4.1-mini", steps: 3, switched: 1, failed: 2, combo: "c1", tier: "t1", truncated: true },
    }),
    ...overrides,
  };
}

function listQuery(db: MockDb): { sql: string; params: unknown[] } {
  const hit = db.calls.find((c) => c.sql.includes("FROM usageHistory") && c.sql.includes("ORDER BY id DESC"));
  expect(hit, "the page query was never issued").toBeTruthy();
  return hit!;
}

function countQuery(db: MockDb): { sql: string; params: unknown[] } {
  const hit = db.calls.find((c) => c.sql.includes("COUNT(*)"));
  expect(hit, "the total count was never issued").toBeTruthy();
  return hit!;
}

beforeEach(() => {
  state.db = null;
});

describe("GET /api/usage/requests — contract", () => {
  it("maps one usage row to the fixed item shape", async () => {
    const db = install(createDb([usageRow()], { refs: [{ id: "det-1", usageId: 123 }] }));

    const body = await (await request()).json();

    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toEqual({
      id: 123,
      timestamp: "2026-10-01T10:00:00.000Z",
      provider: "openai",
      model: "gpt-4.1",
      connectionId: "conn-1",
      endpoint: "/v1/chat/completions",
      promptTokens: 10,
      completionTokens: 5,
      cost: 0.01,
      statusLabel: "success",
      statusRaw: "ok",
      tokens: { cached_tokens: 3, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 },
      routing: { requested: "gpt-4.1", selected: "gpt-4.1-mini", steps: 3, switched: 1, failed: 2, combo: "c1", tier: "t1", truncated: true },
      detailId: "det-1",
    });
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 1 });
    expect(body.filterOptions).toBeUndefined();
    expect(listQuery(db).params[0]).toBe("test-user");
  });

  it("labels ok/success/empty as success and anything else as failed", async () => {
    const statuses = ["ok", "success", "", null, "boom"];
    const db = install(createDb(statuses.map((status, i) => usageRow({ id: i + 1, status }))));

    const body = await (await request()).json();

    expect(body.requests.map((r: { statusLabel: string }) => r.statusLabel)).toEqual([
      "success", "success", "success", "success", "failed",
    ]);
    expect(body.requests.map((r: { statusRaw: string }) => r.statusRaw)).toEqual([
      "ok", "success", "", "", "boom",
    ]);
    expect(countQuery(db).sql).not.toContain("IN (");
  });

  it("keeps cache tokens with 0 defaults and reads routing as null when absent", async () => {
    const db = install(createDb([
      usageRow({ id: 1, tokens: "{}", meta: "{}" }),
      usageRow({ id: 2, tokens: JSON.stringify({ cache_read_input_tokens: 7 }) }),
    ]));

    const body = await (await request()).json();

    expect(body.requests[0].tokens).toEqual({ cached_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(body.requests[0].routing).toBeNull();
    expect(body.requests[0].detailId).toBeNull();
    expect(body.requests[1].tokens).toEqual({ cached_tokens: 7, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 });
    expect(db.calls.some((c) => c.sql.includes("FROM requestDetails"))).toBe(true);
  });

  it("answers filterOptions only when the first load asks for them", async () => {
    const without = install(createDb([usageRow()], { providers: ["openai"], models: ["gpt-4.1"] }));
    expect((await (await request()).json()).filterOptions).toBeUndefined();
    expect(without.calls.some((c) => c.sql.includes("SELECT DISTINCT"))).toBe(false);

    const withIt = install(createDb([usageRow()], { providers: ["openai", "anthropic"], models: ["gpt-4.1"] }));
    const body = await (await request("?includeFilterOptions=1")).json();
    expect(body.filterOptions).toEqual({ providers: ["openai", "anthropic"], models: ["gpt-4.1"] });
    expect(withIt.calls.some((c) => c.sql.includes("SELECT DISTINCT provider"))).toBe(true);
    expect(withIt.calls.some((c) => c.sql.includes("SELECT DISTINCT model"))).toBe(true);
  });
});

describe("GET /api/usage/requests — filters", () => {
  it("filters model and provider by equality", async () => {
    const db = install(createDb([]));

    await request("?model=gpt-4.1&provider=openai");

    const { sql, params } = listQuery(db);
    expect(sql).toContain("model = ?");
    expect(sql).toContain("provider = ?");
    expect(params).toEqual(["test-user", "openai", "gpt-4.1", 20, 0]);
    expect(countQuery(db).params).toEqual(["test-user", "openai", "gpt-4.1"]);
  });

  it("maps range to a timestamp lower bound", async () => {
    const db = install(createDb([]));
    const before = Date.now();

    await request("?range=24h");

    const since = listQuery(db).params[1] as string;
    expect(listQuery(db).sql).toContain("timestamp >= ?");
    const sinceMs = new Date(since).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 50);
    expect(sinceMs).toBeLessThanOrEqual(Date.now() - 24 * 60 * 60 * 1000 + 50);
  });

  it("status=success and status=failed split on the success statuses", async () => {
    const success = install(createDb([]));
    await request("?status=success");
    expect(listQuery(success).sql).toContain(`COALESCE(status, '') IN ('', 'ok', 'success')`);

    const failed = install(createDb([]));
    await request("?status=failed");
    expect(listQuery(failed).sql).toContain(`COALESCE(status, '') NOT IN ('', 'ok', 'success')`);
  });

  it("fallback=true keeps only rows that switched away from the requested model", async () => {
    const db = install(createDb([]));

    await request("?fallback=true");

    const { sql } = listQuery(db);
    expect(sql).toContain("{routing,switched}");
    expect(sql).toContain("{routing,selected}");
    expect(sql).toContain("{routing,requested}");
    expect(countQuery(db).sql).toContain("{routing,switched}");
  });

  it("hasFailed=true keeps only rows whose routing recorded failures", async () => {
    const db = install(createDb([]));

    await request("?hasFailed=true");

    expect(listQuery(db).sql).toContain("{routing,failed}");
    expect(countQuery(db).sql).toContain("{routing,failed}");
  });
});

describe("GET /api/usage/requests — pagination", () => {
  it("orders by id DESC, slices with LIMIT/OFFSET and counts the same filter", async () => {
    const db = install(createDb([usageRow()], { total: 57 }));

    const body = await (await request("?page=3&pageSize=10")).json();

    const { sql, params } = listQuery(db);
    expect(sql).toContain("ORDER BY id DESC");
    expect(params).toEqual(["test-user", 10, 20]);
    expect(body.pagination).toEqual({ page: 3, pageSize: 10, totalItems: 57 });
  });

  it.each([
    ["?page=0", "Page must be >= 1"],
    ["?pageSize=500", "PageSize must be between 1 and 100"],
    ["?status=maybe", "Status must be success or failed"],
    ["?range=1y", "Range must be one of"],
  ])("rejects %s with 400", async (query, message) => {
    install(createDb([]));
    const response = await request(query);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(message);
  });
});
