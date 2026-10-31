import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/store/notificationStore", () => ({ notify: notifyMock }));

import { useProviderActions } from "@/app/(dashboard)/dashboard/providers/hooks/useProviderActions";
import type { Connection } from "@/app/(dashboard)/dashboard/providers/types";

function makeStore(initial: Connection[]) {
  let state = initial;
  const setConnections = vi.fn((updater: Connection[] | ((prev: Connection[]) => Connection[])) => {
    state = typeof updater === "function" ? updater(state) : updater;
  });
  return { setConnections, read: () => state };
}

function connection(id: string): Connection {
  return { id, provider: "openai", authType: "apikey", isActive: true } as unknown as Connection;
}

describe("useProviderActions.handleToggleProvider", () => {
  beforeEach(() => {
    notifyMock.error.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores only the connections whose PUT failed and reports the error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/c1") ? new Response("{}", { status: 200 }) : new Response("{}", { status: 500 }),
    ));
    const store = makeStore([connection("c1"), connection("c2")]);
    const actions = useProviderActions(store.read(), store.setConnections, null, vi.fn(), vi.fn());

    await actions.handleToggleProvider("openai", "apikey", false);

    expect(store.read().map((c) => [c.id, c.isActive])).toEqual([["c1", false], ["c2", true]]);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });

  it("keeps the new state and stays quiet when every PUT succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const store = makeStore([connection("c1")]);
    const actions = useProviderActions(store.read(), store.setConnections, null, vi.fn(), vi.fn());

    await actions.handleToggleProvider("openai", "apikey", false);

    expect(store.read()[0].isActive).toBe(false);
    expect(notifyMock.error).not.toHaveBeenCalled();
  });
});

describe("useProviderActions.handleBatchTest", () => {
  it("reports an empty group as info instead of an all-passed success", async () => {
    notifyMock.info.mockClear();
    notifyMock.success.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ summary: { passed: 0, failed: 0, total: 0 } }), { status: 200 }),
    ));
    const actions = useProviderActions([], vi.fn(), null, vi.fn(), vi.fn());

    await actions.handleBatchTest("oauth");

    expect(notifyMock.success).not.toHaveBeenCalled();
    expect(notifyMock.info).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
