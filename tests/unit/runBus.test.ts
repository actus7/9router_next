import { describe, expect, it, vi } from "vitest";

import { publishRunText, subscribeRun } from "@/server/application/use-cases/harness/runBus";

describe("run bus", () => {
  it("delivers published text to every subscriber of that run only", () => {
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    const offA = subscribeRun("run-a", a);
    const offB = subscribeRun("run-a", b);
    const offOther = subscribeRun("run-other", other);

    publishRunText("run-a", "hello");

    expect(a).toHaveBeenCalledWith("hello");
    expect(b).toHaveBeenCalledWith("hello");
    expect(other).not.toHaveBeenCalled();
    offA();
    offB();
    offOther();
  });

  it("stops delivering after unsubscribe and tolerates publishing to nobody", () => {
    const listener = vi.fn();
    const off = subscribeRun("run-b", listener);
    off();

    expect(() => publishRunText("run-b", "late")).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("lets a subscriber unsubscribe from inside its own callback", () => {
    const second = vi.fn();
    const off = subscribeRun("run-c", () => off());
    const offSecond = subscribeRun("run-c", second);

    publishRunText("run-c", "x");

    expect(second).toHaveBeenCalledWith("x");
    offSecond();
  });

  it("uses null as a wake-up with no text", () => {
    const listener = vi.fn();
    const off = subscribeRun("run-d", listener);
    publishRunText("run-d", null);
    expect(listener).toHaveBeenCalledWith(null);
    off();
  });
});
