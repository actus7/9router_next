// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isExtensionReply, useWebSessionExtension } from "@/shared/hooks/useWebSessionExtension";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const reply = (requestId: string, data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", {
  source: window, origin: window.location.origin,
  data: { channel: "modelhub-web-session-v1", direction: "extension", requestId, ...data },
}));

describe("dashboard extension handshake", () => {
  it("rejects other origins, windows and requests", () => {
    const data = { channel: "modelhub-web-session-v1", direction: "extension", requestId: "id" };
    expect(isExtensionReply(new MessageEvent("message", { source: window, origin: window.location.origin, data }), "id")).toBe(true);
    expect(isExtensionReply(new MessageEvent("message", { source: window, origin: "https://evil.example", data }), "id")).toBe(false);
    expect(isExtensionReply(new MessageEvent("message", { source: null, origin: window.location.origin, data }), "id")).toBe(false);
    expect(isExtensionReply(new MessageEvent("message", { source: window, origin: window.location.origin, data }), "other")).toBe(false);
  });
  it("detects missing extensions without claiming success", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWebSessionExtension());
    act(() => vi.advanceTimersByTime(1801));
    expect(result.current.state).toBe("missing");
  });
  it("passes a captured session once and ignores results after cancellation", async () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const { result } = renderHook(() => useWebSessionExtension());
    const hello = post.mock.calls[0][0];
    act(() => reply(hello.requestId, { type: "hello", protocol: 1, version: "1.0.0", providers: ["zai-web"] }));
    expect(result.current.state).toBe("ready");
    const captured = vi.fn();
    act(() => result.current.connect("zai-web", captured));
    const request = post.mock.calls.find(([data]) => data.type === "connect")![0];
    act(() => reply(request.requestId, { type: "captured", credential: "session" }));
    await waitFor(() => expect(captured).toHaveBeenCalledExactlyOnceWith("session"));
    act(() => reply(request.requestId, { type: "captured", credential: "again" }));
    expect(captured).toHaveBeenCalledTimes(1);
    act(() => result.current.connect("zai-web", captured));
    const latest = post.mock.calls.filter(([data]) => data.type === "connect").at(-1)![0];
    act(() => result.current.cancel());
    act(() => reply(latest.requestId, { type: "captured", credential: "late" }));
    expect(captured).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });
});
