// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/dashboard/web-providers" }
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = readFileSync(resolve(process.cwd(), "packages/modelhub-web-sessions/bridge.js"), "utf8");
const requestId = "aaaaaaaa-bbbb-cccc-dddd";

const load = (sendMessage: () => unknown) => {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { id: "ext", sendMessage, onMessage: { addListener: () => {} } },
  };
  new Function(bridge)();
};

const send = () => window.dispatchEvent(new MessageEvent("message", {
  source: window, origin: window.location.origin,
  data: { channel: "modelhub-web-session-v1", direction: "dashboard", type: "connect", requestId, provider: "zai-web" },
}));

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__modelhubSessionBridge;
  delete (globalThis as Record<string, unknown>).chrome;
  vi.restoreAllMocks();
});

describe("bridge.js content script", () => {
  it("reports a dead extension context instead of throwing", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    load(() => { throw new Error("Extension context invalidated."); });
    expect(send).not.toThrow();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, type: "error", error: expect.stringContaining("Recarregue") }),
      window.location.origin,
    );
  });

  it("relays the worker response for a live context", async () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    load(() => Promise.resolve({ type: "captured", credential: "session" }));
    send();
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, type: "captured", credential: "session" }),
      window.location.origin,
    ));
  });
});
