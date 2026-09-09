import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { setupHttp2Request } from "@/server/llm-gateway/engine/executors/cursorSseProtocol";

/**
 * The AgentService transport is HTTP/2 and hand-rolled: chunks arrive on an
 * event and a single reader pulls them through a promise. Both halves were
 * wrong at once — chunks that arrived while one was queued were dropped, and a
 * reader already waiting was never woken — so a text-only Cursor turn came back
 * as a well-formed, empty completion. Nothing upstream could tell.
 */
function harness() {
  const req = new EventEmitter() as EventEmitter & { destroyed: boolean };
  req.destroyed = false;
  const client = { request: () => req } as unknown as ReturnType<typeof import("http2").connect>;

  const chunkQueue: Buffer[] = [];
  let waiting: ((v: { value: Buffer | undefined; done: boolean } | null) => void) | null = null;
  const state = { ended: false, streamError: null as Error | null };

  const wake = (result: { value: Buffer | undefined; done: boolean } | null): boolean => {
    if (!waiting) return false;
    const resolve = waiting;
    waiting = null;
    resolve(result);
    return true;
  };

  async function read(): Promise<{ value: Buffer | undefined; done: boolean }> {
    if (chunkQueue.length) return { value: chunkQueue.shift(), done: false };
    if (state.ended) {
      if (state.streamError) throw state.streamError;
      return { value: undefined, done: true };
    }
    const result = await new Promise<{ value: Buffer | undefined; done: boolean } | null>((r) => { waiting = r; });
    if (state.streamError) throw state.streamError;
    return result || { value: undefined, done: true };
  }

  setupHttp2Request(client, new URL("https://agent.example/run"), {}, state, wake, chunkQueue);
  return { req, read };
}

async function drain(read: () => Promise<{ value: Buffer | undefined; done: boolean }>): Promise<string> {
  let out = "";
  for (;;) {
    const { value, done } = await read();
    if (done) return out;
    out += value!.toString();
  }
}

describe("cursor AgentService http2 transport", () => {
  it("keeps every chunk that arrives before the reader drains the queue", async () => {
    const { req, read } = harness();
    req.emit("data", Buffer.from("one"));
    req.emit("data", Buffer.from("two"));
    req.emit("data", Buffer.from("three"));
    req.emit("end");

    expect(await drain(read)).toBe("onetwothree");
  });

  it("wakes a reader that is already waiting when a chunk arrives", async () => {
    const { req, read } = harness();
    const pending = read();
    req.emit("data", Buffer.from("hello"));

    const { value, done } = await pending;
    expect(done).toBe(false);
    expect(value?.toString()).toBe("hello");
  });

  it("delivers a body that only arrives after the reader parks", async () => {
    const { req, read } = harness();
    const collected = drain(read);
    req.emit("data", Buffer.from("a"));
    req.emit("data", Buffer.from("b"));
    req.emit("end");

    expect(await collected).toBe("ab");
  });
});
