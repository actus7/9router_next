import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client and the server halves of a durable run, wired to each other.
 *
 * Every other test in this set mocks one side of the boundary. This one runs
 * the real client code against the real route handlers over a fake `fetch`,
 * with only the database and the provider stubbed — because the failure that
 * reached the user lived exactly in that seam: a run whose worker died stayed
 * `running`, the watcher never reached a terminal state, and the promise the
 * chat was awaiting never settled. Nothing that mocks one side can catch that.
 *
 * The invariant asserted throughout: `executeDurableChat` always settles.
 * A chat whose send promise hangs leaves `isSending` true forever, and the
 * composer disabled with no way back.
 */

const STALE_RUN_MS = 60 * 1000;

interface Row {
  id: string;
  sessionId: string;
  messageId: string;
  status: "running" | "completed" | "failed" | "stopped";
  model: string | null;
  partialText: string;
  reasoning: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const db = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));

vi.mock("@/lib/db/repos/harnessRunsRepo", () => {
  const rows = db.rows as Map<string, Row>;
  const now = () => new Date().toISOString();
  return {
    STALE_RUN_MS: 60 * 1000,
    createHarnessRun: vi.fn(async (run: { id: string; sessionId: string; messageId: string; model: string | null }) => {
      const row: Row = {
        ...run,
        status: "running",
        partialText: "",
        reasoning: null,
        toolCalls: [],
        usage: null,
        error: null,
        createdAt: now(),
        updatedAt: now(),
      };
      rows.set(run.id, row);
      return row;
    }),
    updateHarnessRunProgress: vi.fn(async (id: string, partialText: string) => {
      const row = rows.get(id);
      if (!row || row.status !== "running") return false;
      rows.set(id, { ...row, partialText, updatedAt: now() });
      return true;
    }),
    settleHarnessRun: vi.fn(async (id: string, result: Partial<Row> & { status: Row["status"] }) => {
      const row = rows.get(id);
      // Faithful to the real UPDATE, which matches only `running`: a stub that
      // settles anything lets a stop be overwritten in tests but not in Neon.
      if (!row || row.status !== "running") return;
      rows.set(id, {
        ...row,
        ...result,
        partialText: result.partialText ?? row.partialText,
        updatedAt: now(),
      });
    }),
    stopHarnessRun: vi.fn(async (id: string) => {
      const row = rows.get(id);
      if (row?.status === "running") rows.set(id, { ...row, status: "stopped", updatedAt: now() });
    }),
    getHarnessRun: vi.fn(async (id: string) => rows.get(id) ?? null),
    MAX_CONCURRENT_RUNS: 12,
    countRunningHarnessRuns: vi.fn(async () =>
      [...rows.values()].filter((row) => row.status === "running").length,
    ),
    listHarnessRunsSince: vi.fn(async (sessionId: string) =>
      [...rows.values()].filter((row) => row.sessionId === sessionId),
    ),
    listHarnessRunStates: vi.fn(async () =>
      [...rows.values()].map((row) => ({ sessionId: row.sessionId, status: row.status })),
    ),
    deleteHarnessRuns: vi.fn(async (ids: readonly string[]) => {
      for (const id of ids) rows.delete(id);
    }),
    failStaleHarnessRuns: vi.fn(async () => {
      let reaped = 0;
      for (const [id, row] of rows) {
        if (row.status !== "running") continue;
        if (Date.now() - Date.parse(row.updatedAt) <= STALE_RUN_MS) continue;
        rows.set(id, { ...row, status: "failed", error: "The run stopped without finishing.", updatedAt: now() });
        reaped += 1;
      }
      return reaped;
    }),
  };
});

vi.mock("@/lib/db/tenant", () => ({
  currentTenantId: () => "test-user",
  withTenant: (_owner: string, fn: () => unknown) => fn(),
}));
vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));

const handleChat = vi.hoisted(() => vi.fn());
vi.mock("@/server/llm-gateway/chat", () => ({ handleChat }));
vi.mock("@/server/llm-gateway/translator", () => ({ initTranslators: vi.fn(async () => undefined) }));

const pending: Array<Promise<unknown>> = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    pending.push(promise);
  },
}));

import { executeDurableChat, stopDurableRun } from "@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat";
import {
  GET as runsGET,
  PATCH as runsPATCH,
  POST as runsPOST,
} from "@/server/application/use-cases/http/harness/runs/route";
import { GET as streamGET } from "@/server/application/use-cases/http/harness/runs/stream/route";

/** Routes the client's `fetch` calls into the real handlers. */
function wireFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      // A real fetch rejects on an already-aborted signal. Without this the
      // fake one would quietly succeed and no abort could ever be exercised.
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const url = new URL(String(input), "http://localhost");
      const request = new Request(url, init) as never;

      const stream = /^\/api\/harness\/runs\/([^/]+)\/stream$/.exec(url.pathname);
      if (stream) {
        return await streamGET(request, { params: Promise.resolve({ runId: decodeURIComponent(stream[1]!) }) });
      }
      if (url.pathname === "/api/harness/runs") {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST") return await runsPOST(withNextUrl(request, url));
        if (method === "PATCH") return await runsPATCH(withNextUrl(request, url));
        return await runsGET(withNextUrl(request, url));
      }
      throw new Error(`unrouted: ${url.pathname}`);
    }),
  );
}

/** The handlers read `nextUrl`; a plain Request has only `url`. */
function withNextUrl(request: unknown, url: URL): never {
  Object.defineProperty(request, "nextUrl", { value: url, configurable: true });
  return request as never;
}

function sseResponse(chunks: readonly string[], hold = false): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        // `hold` models a worker that stops writing and never returns: the
        // stream neither closes nor errors, exactly like an invocation killed
        // mid-read.
        if (hold) return;
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

function send(overrides: Partial<Parameters<typeof executeDurableChat>[0]> = {}) {
  return executeDurableChat({
    sessionId: "session-1",
    messageId: "message-1",
    fetchOptions: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer key" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
    },
    signal: new AbortController().signal,
    onStreamText: () => {},
    ...overrides,
  });
}

describe("durable run, client through server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.rows.clear();
    pending.length = 0;
    wireFetch();
  });

  it("delivers the answer the worker produced", async () => {
    handleChat.mockResolvedValue(sseResponse([frame("Hello"), frame(" world")]));
    const seen: string[] = [];

    const result = await send({ onStreamText: (text: string) => seen.push(text) });

    expect(result.text).toBe("Hello world");
    expect(seen.at(-1)).toBe("Hello world");
  });

  it("keeps producing after the reader walks away, and hands the answer to the next visit", async () => {
    handleChat.mockResolvedValue(sseResponse([frame("half"), frame(" and half")]));
    const controller = new AbortController();

    // Leaving the screen aborts the watcher and nothing else. Aborting from
    // `onRunId` puts it at the earliest realistic moment: the run exists on the
    // server, and the tab is gone before a single frame has been read.
    await expect(
      send({ signal: controller.signal, onRunId: () => controller.abort() }),
    ).rejects.toThrow();
    await Promise.all(pending);

    // What a returning tab asks for.
    const response = await runsGET(withNextUrl(new Request("http://localhost/api/harness/runs?sessionId=session-1"), new URL("http://localhost/api/harness/runs?sessionId=session-1")));
    const { runs } = (await response.json()) as { runs: Row[] };

    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    expect(runs[0]!.partialText).toBe("half and half");
  });

  it("settles instead of hanging when the worker dies mid-run", async () => {
    // THE REGRESSION. The provider stream opens, sends a little, then stops
    // forever without closing — a killed invocation. The row keeps saying
    // `running` and its heartbeat stops. Before the fix the watcher polled it
    // forever and this promise never settled, which is what left the composer
    // disabled with no way back.
    handleChat.mockResolvedValue(sseResponse([frame("started")], true));

    const started = send();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Age the row past the heartbeat window, as wall-clock would.
    const row = db.rows.get([...db.rows.keys()][0]!) as Row;
    db.rows.set(row.id, { ...row, updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() });

    await expect(started).rejects.toThrow();
    expect((db.rows.get(row.id) as Row).status).toBe("failed");
  }, 20_000);

  it("stops on purpose, and the worker gives up its provider connection", async () => {
    handleChat.mockResolvedValue(sseResponse(Array.from({ length: 200 }, (_, i) => frame(`chunk-${i}`)), true));

    let runId = "";
    const started = send({ onRunId: (id: string) => { runId = id; } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    await stopDurableRun(runId);

    await expect(started).rejects.toMatchObject({ name: "AbortError" });
    expect((db.rows.get(runId) as Row).status).toBe("stopped");
  }, 20_000);

  it("survives the same run being watched twice at once", async () => {
    // Leaving and returning quickly can leave the previous watcher alive while
    // the new one attaches. Both must settle, with the same answer.
    handleChat.mockResolvedValue(sseResponse([frame("shared")]));

    let runId = "";
    const first = send({ onRunId: (id: string) => { runId = id; } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { watchDurableRun } = await import("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat");
    const second = watchDurableRun(runId, { onStreamText: () => {} });

    const [a, b] = await Promise.all([first, second]);
    expect(a.text).toBe("shared");
    expect(b.text).toBe("shared");
  });

  it("refuses to call a truncated answer a finished one", async () => {
    // Found in review: the row can vanish under the watcher (a session sync
    // sweeping it) or the server can hit its watch ceiling. Either way the
    // stream ends with the run still `running`. There was no branch for that,
    // so a fragment was returned as a successful result and filed as a
    // complete message — a lost answer with no error anywhere.
    handleChat.mockResolvedValue(sseResponse([frame("half an ans")], true));

    let runId = "";
    const started = send({ onRunId: (id: string) => { runId = id; } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    db.rows.delete(runId);

    await expect(started).rejects.toThrow(/interrupted/i);
  }, 20_000);
});
