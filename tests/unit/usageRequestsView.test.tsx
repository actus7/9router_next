// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The drawer shell is Base UI sheet plumbing (portals, positioning); the tests
// cover the panel's own behavior, so the shell is reduced to an open/close box.
vi.mock("@/shared/components/Drawer", () => ({
  default: ({ isOpen, title, children }: { isOpen: boolean; onClose: () => void; title?: string; children: ReactNode }) =>
    isOpen ? (
      <div data-testid="drawer">
        <p>{title}</p>
        {children}
      </div>
    ) : null,
}));

import RequestDetailsTab from "@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab";

const iso = new Date(2026, 8, 7, 14, 32, 8).toISOString();

const ROW_PLAIN = {
  id: 1,
  timestamp: iso,
  provider: "anthropic",
  model: "llama-3.1-70b",
  connectionId: "c1",
  endpoint: "/v1/chat/completions",
  promptTokens: 120,
  completionTokens: 80,
  cost: 0.5,
  statusLabel: "success",
  statusRaw: "ok",
  tokens: { cache_read_input_tokens: 300, cache_creation_input_tokens: 100 },
  routing: { requested: "llama-3.1-70b", selected: "llama-3.1-70b", steps: 1 },
  detailId: 11,
};

const ROW_JUMP = {
  id: 2,
  timestamp: iso,
  provider: "openai",
  model: "gpt-4o",
  connectionId: "c2",
  endpoint: "/v1/responses",
  promptTokens: 10,
  completionTokens: 5,
  cost: 0.0000421234567,
  statusLabel: "failed",
  statusRaw: "upstream 529 overloaded",
  tokens: {},
  routing: {
    requested: "gpt-4o",
    selected: "claude-3-5-sonnet",
    steps: 3,
    switched: 1,
    failed: 2,
    combo: "combo-x",
    tier: "pro",
  },
  detailId: null,
};

const RECORDED_DETAIL = {
  id: "d9",
  timestamp: iso,
  model: "llama-3.1-70b",
  provider: "anthropic",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  latency: { ttft: 10, total: 20 },
  status: "success",
  request: {
    routing: { need: "chat", tier: "pro", confidence: 0.8, reason: "fit", candidates: ["m1"] },
    messages: [],
  },
  response: { content: "hi" },
};

type FetchState = {
  requests: unknown[];
  detail: unknown | null;
  holdList: boolean;
};

const state: FetchState = { requests: [], detail: null, holdList: false };

function listUrls(): string[] {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.map((args) => String(args[0])).filter((url) => url.startsWith("/api/usage/requests"));
}

function lastListUrl(): string {
  const urls = listUrls();
  return urls[urls.length - 1] ?? "";
}

function renderTab() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <RequestDetailsTab />
    </SWRConfig>,
  );
}

beforeEach(() => {
  state.requests = [];
  state.detail = null;
  state.holdList = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/usage/requests")) {
        if (state.holdList) return new Promise<Response>(() => {});
        return new Response(
          JSON.stringify({
            requests: state.requests,
            pagination: { page: 1, pageSize: 20, totalItems: state.requests.length },
            filterOptions: { providers: ["anthropic", "openai"], models: ["llama-3.1-70b", "gpt-4o"] },
          }),
        );
      }
      if (url.startsWith("/api/usage/request-details")) {
        if (state.detail === null) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(state.detail));
      }
      if (url.startsWith("/api/settings")) return new Response(JSON.stringify({ enableObservability: false }));
      if (url.startsWith("/api/provider-nodes")) return new Response(JSON.stringify({ nodes: [] }));
      return new Response(JSON.stringify({}));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("requests list", () => {
  it("keeps the observability switch and shows skeleton rows while loading", async () => {
    state.holdList = true;
    renderTab();
    expect(screen.getByRole("switch", { name: "Enable Observability" })).toBeTruthy();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(7); // header + 6 skeleton rows
  });

  it("renders status pills, the model jump, attempts badges and usage cells", async () => {
    state.requests = [ROW_PLAIN, ROW_JUMP];
    renderTab();
    const table = await screen.findByRole("table");
    const list = within(table);

    expect(list.getByText("Success")).toBeTruthy();
    const failed = list.getByText("Failed");
    expect(failed.getAttribute("title")).toBe("upstream 529 overloaded");

    // The visible jump: requested → selected, in mono.
    expect(list.getByText("gpt-4o")).toBeTruthy();
    expect(list.getByText("claude-3-5-sonnet")).toBeTruthy();

    // Who failed / who fell back.
    expect(list.getByTitle("Failed attempts").textContent).toContain("2");
    expect(list.getByText("fallback")).toBeTruthy();

    // Cost keeps the full value on hover; cache reads as Read/Write.
    expect(list.getByText("$0.000042")).toBeTruthy();
    expect(list.getByTitle("$0.0000421234567")).toBeTruthy();
    expect(list.getByText("Read: 300 / Write: 100")).toBeTruthy();

    expect(screen.getByText("2 requests")).toBeTruthy();
  });

  it("separates the empty-without-filters state from the empty-with-filters one", async () => {
    renderTab();
    expect(await screen.findByText("No requests recorded yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "With failed attempts" }));
    await waitFor(() => expect(lastListUrl()).toContain("hasFailed=true"));

    expect(await screen.findByText("No requests match the current filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(lastListUrl()).not.toContain("hasFailed=true"));
    expect(await screen.findByText("No requests recorded yet.")).toBeTruthy();
  });
});

describe("request drawer", () => {
  it("opens the self-contained drawer when no bodies were recorded", async () => {
    state.requests = [ROW_PLAIN, ROW_JUMP];
    renderTab();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getAllByRole("row")[2]); // the jumped row

    const drawer = await screen.findByTestId("drawer");
    const body = within(drawer);
    expect(body.getByText("Request Details")).toBeTruthy();
    expect(body.getByText("/v1/responses")).toBeTruthy();
    expect(body.getByText(/Full request and response bodies are only recorded/)).toBeTruthy();

    // Rows without an attempt trail still tell who answered, who was asked for and what failed.
    expect(body.getByRole("heading", { name: "Answered by claude-3-5-sonnet" })).toBeTruthy();
    expect(body.getByText(/requested gpt-4o/)).toBeTruthy();
    expect(body.getByText(/2 failed attempts/)).toBeTruthy();
    expect(body.getByText(/account fallback/)).toBeTruthy();
    expect(body.getByText(/combo-x/)).toBeTruthy();
    expect(body.getByText(/tier: pro/)).toBeTruthy();

    // The inline switch writes the same observability setting.
    expect(body.getAllByRole("switch")).toHaveLength(1);
    await waitFor(() =>
      expect(
        (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
          (args) => String(args[0]).includes("usageId=2"),
        ),
      ).toBe(true),
    );
  });

  it("shows the recorded bodies when observability captured them", async () => {
    state.requests = [ROW_PLAIN];
    state.detail = { detail: RECORDED_DETAIL };
    renderTab();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getAllByRole("row")[1]);

    const body = within(await screen.findByTestId("drawer"));
    expect(body.getByText("1. Client Request (Input)")).toBeTruthy();
    expect(body.getByText("Smart routing")).toBeTruthy();
    expect(body.getByText("ID")).toBeTruthy();
  });
});
