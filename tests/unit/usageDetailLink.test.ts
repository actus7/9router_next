import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The list→drawer link. `usageHistory` is always written and is what the
 * Requests list pages over; `requestDetails` holds the bodies but is opt-in and
 * pruned. Since the link landed, the settle path stamps the usage row id into
 * the detail record (`usageId`), and `?usageId=` on request-details is how the
 * drawer opens one request's bodies - or answers 404 when there is nothing to
 * open (observability off, pruned, or a row from before the link).
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

function createDb(handlers: {
  existing?: Record<string, unknown>;
  insertedId?: number;
  detailRows?: Array<Record<string, unknown>>;
}): MockDb {
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
      if (sql.includes("SELECT id, endpoint FROM usageHistory")) return handlers.existing;
      if (sql.includes("INSERT INTO usageHistory")) return { id: handlers.insertedId ?? 42 };
      return undefined;
    }),
    all: vi.fn(async (sql: string, params?: unknown[]) => {
      record(sql, params);
      if (sql.includes("FROM requestDetails")) return handlers.detailRows ?? [];
      return [];
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
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({
    enableObservability: true,
    observabilityBatchSize: 1,
    observabilityMaxRecords: 1000,
  })),
}));
const hostUsage = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(async (_entry: Record<string, unknown>) => 55),
  saveRequestDetail: vi.fn(async (_detail: Record<string, unknown>) => {}),
}));
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  ...hostUsage,
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
}));

import { GET as requestDetailsGET } from "@/app/api/usage/request-details/route";
import { saveRequestUsage } from "@/lib/db/repos/usageRepo";
import { saveRequestDetail } from "@/lib/db/repos/requestDetailsRepo";
import { handleNonStreamingResponse } from "@/server/llm-gateway/engine/handlers/chatCore/nonStreamingHandler";

function install(db: MockDb): MockDb {
  state.db = db;
  return db;
}

function request(query = ""): Promise<Response> {
  return requestDetailsGET(new NextRequest(`http://localhost/api/usage/request-details${query}`)) as unknown as Promise<Response>;
}

const fullDetail = {
  id: "det-1",
  usageId: 77,
  provider: "openai",
  model: "gpt-4.1",
  timestamp: "2026-10-01T10:00:00.000Z",
  status: "success",
  latency: { ttft: 12, total: 34 },
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  request: { messages: [{ role: "user", content: "hi" }] },
  providerRequest: { model: "gpt-4.1" },
  providerResponse: { choices: [{ message: { content: "yo" } }] },
  response: { content: "yo", thinking: null, finish_reason: "stop" },
};

beforeEach(() => {
  state.db = null;
  hostUsage.saveRequestUsage.mockClear();
  hostUsage.saveRequestDetail.mockClear();
});

describe("saveRequestUsage answers the row id", () => {
  it("returns the inserted id (INSERT … RETURNING id)", async () => {
    const db = install(createDb({ insertedId: 42 }));

    await expect(
      saveRequestUsage({ provider: "openai", model: "gpt-4.1", tokens: { prompt_tokens: 1, completion_tokens: 1 } }),
    ).resolves.toBe(42);

    const insert = db.calls.find((c) => c.sql.includes("INSERT INTO usageHistory"));
    expect(insert, "the usage row was never inserted").toBeTruthy();
    expect(insert!.sql).toContain("RETURNING id");
  });

  it("returns the existing row id when the write-time dedupe hits", async () => {
    const db = install(createDb({ existing: { id: 7, endpoint: "/v1/x" } }));

    await expect(
      saveRequestUsage({ provider: "openai", model: "gpt-4.1", tokens: { prompt_tokens: 1, completion_tokens: 1 } }),
    ).resolves.toBe(7);

    expect(db.calls.some((c) => c.sql.includes("INSERT INTO usageHistory"))).toBe(false);
  });
});

describe("saveRequestDetail records the link", () => {
  it("stores the usage row id inside the detail record", async () => {
    const db = install(createDb({}));

    await saveRequestDetail({ provider: "openai", model: "gpt-4.1", status: "success", usageId: 77 });

    const insert = db.calls.find((c) => c.sql.includes("INSERT INTO requestDetails"));
    expect(insert, "the detail was never written").toBeTruthy();
    const data = String(insert!.params[insert!.params.length - 1]);
    expect(data).toContain('"usageId":77');
    // The drawer reads the same field back.
    expect(data).toContain('"model":"gpt-4.1"');
  });
});

describe("GET /api/usage/request-details?usageId=", () => {
  it("answers the complete record, bodies included", async () => {
    install(createDb({ detailRows: [{ data: JSON.stringify(fullDetail) }] }));

    const response = await request("?usageId=77");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.detail).toEqual(fullDetail);
    // What the drawer is here for: the conversation payloads, not the
    // redaction the list endpoint substitutes.
    expect(body.detail.request.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.detail.providerRequest).toEqual({ model: "gpt-4.1" });
    expect(body.detail.providerResponse).toEqual({ choices: [{ message: { content: "yo" } }] });
  });

  it("answers 404 when nothing is recorded for that usageId", async () => {
    install(createDb({ detailRows: [] }));

    const response = await request("?usageId=999");

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Request detail not found");
  });

  it("answers 400 for a usageId that is not a positive integer", async () => {
    install(createDb({ detailRows: [] }));

    expect((await request("?usageId=abc")).status).toBe(400);
    expect((await request("?usageId=0")).status).toBe(400);
  });

  it("still redacts bodies on the paginated list (regression)", async () => {
    const db = install(createDb({ detailRows: [{ data: JSON.stringify(fullDetail) }] }));

    const response = await request("?page=1&pageSize=10");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.details).toHaveLength(1);
    expect(body.details[0].request).toEqual({ redacted: true });
    expect(body.details[0].providerRequest).toEqual({ redacted: true });
    expect(body.details[0].providerResponse).toEqual({ redacted: true });
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 10 });
    // The list path never asked for the usageId lookup.
    expect(db.calls.some((c) => c.sql.includes("ORDER BY timestamp DESC"))).toBe(true);
  });
});

describe("the settle path passes the id along", () => {
  it("stamps the usage row id into the request detail of the same request", async () => {
    const upstream = {
      id: "chatcmpl-1",
      model: "m",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(upstream), { headers: { "content-type": "application/json" } }),
      provider: "openai", model: "m", sourceFormat: "openai", targetFormat: "openai",
      body: {}, stream: false, translatedBody: {}, requestStartTime: Date.now(), connectionId: "c",
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} }, toolNameMap: new Map(),
      trackDone() {}, appendLog() {},
    } as unknown as Parameters<typeof handleNonStreamingResponse>[0]);

    // The detail write rides the usage write's promise, so it settles after
    // the handler has already answered.
    await vi.waitFor(() => expect(hostUsage.saveRequestDetail).toHaveBeenCalledTimes(1));
    expect(hostUsage.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(hostUsage.saveRequestDetail.mock.calls[0]![0]).toMatchObject({ usageId: 55, model: "m" });
  });
});
