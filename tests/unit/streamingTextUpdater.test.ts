import { describe, expect, it, vi } from "vitest";

import { createStreamingTextUpdater } from "@/app/(dashboard)/dashboard/basic-chat/hooks/streamingTextUpdater";

/** A frame scheduler the test drives by hand, standing in for requestAnimationFrame. */
function manualFrames() {
  const queue: Array<() => void> = [];
  return {
    schedule: (callback: () => void) => {
      queue.push(callback);
      return () => {
        const index = queue.indexOf(callback);
        if (index >= 0) queue.splice(index, 1);
      };
    },
    pending: () => queue.length,
    run: () => queue.splice(0).forEach((callback) => callback()),
  };
}

function setup(persistIntervalMs = 500) {
  const frames = manualFrames();
  let clock = 0;
  const applyFrame = vi.fn();
  const persist = vi.fn();
  const updater = createStreamingTextUpdater({
    applyFrame,
    persist,
    persistIntervalMs,
    schedule: frames.schedule,
    now: () => clock,
  });
  return { frames, applyFrame, persist, updater, tick: (ms: number) => (clock += ms) };
}

/**
 * Every network chunk used to run three React state updates, one of them a
 * `map` over every message of the session. At token rate that is the page
 * re-rendering faster than any display can show.
 */
describe("streaming text updater", () => {
  it("collapses a burst of chunks into one frame carrying the latest text", () => {
    const { frames, applyFrame, updater } = setup();

    for (const text of ["H", "He", "Hel", "Hell", "Hello"]) updater.push(text);

    expect(applyFrame).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);
    frames.run();
    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith("Hello");
  });

  it("persists the first frame, then at most once per interval", () => {
    const { frames, persist, updater, tick } = setup(500);

    updater.push("a");
    frames.run();
    expect(persist).toHaveBeenCalledTimes(1);

    tick(100);
    updater.push("ab");
    frames.run();
    tick(100);
    updater.push("abc");
    frames.run();
    expect(persist).toHaveBeenCalledTimes(1);

    tick(400);
    updater.push("abcd");
    frames.run();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("abcd");
  });

  it("flush persists text a throttled frame had not stored yet", () => {
    const { frames, persist, updater, tick } = setup(500);

    updater.push("a");
    frames.run();
    tick(50);
    updater.push("abc");
    frames.run();
    expect(persist).toHaveBeenCalledTimes(1);

    updater.flush();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("abc");
  });

  it("flush applies a frame that has not run yet and cancels it", () => {
    const { frames, applyFrame, persist, updater } = setup();

    updater.push("late");
    updater.flush();

    expect(applyFrame).toHaveBeenCalledWith("late");
    expect(persist).toHaveBeenCalledWith("late");
    expect(frames.pending()).toBe(0);
  });

  it("flush with nothing new does not write again", () => {
    const { frames, persist, updater } = setup();

    updater.push("same");
    frames.run();
    updater.flush();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("cancel drops pending work", () => {
    const { frames, applyFrame, persist, updater } = setup();

    updater.push("never shown");
    updater.cancel();
    frames.run();

    expect(applyFrame).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
