import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitFirstChunk,
  getFirstByteBudget,
  setFirstByteBudget,
} from "@/server/llm-gateway/engine/utils/firstByteGuard";

const enc = new TextEncoder();

/** An SSE-like upstream whose chunks arrive after the given delays (ms). */
function upstream(chunks: Array<{ at: number; text: string }>, onCancel?: () => void): Response {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = 0;
      for (const chunk of chunks) {
        await new Promise((r) => setTimeout(r, chunk.at - last));
        last = chunk.at;
        if (cancelled) return;
        controller.enqueue(enc.encode(chunk.text));
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
      onCancel?.();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("firstByteBudget on the body", () => {
  it("round-trips and clears", () => {
    const body: Record<string, unknown> = {};
    expect(getFirstByteBudget(body)).toBeUndefined();
    setFirstByteBudget(body, 5000);
    expect(getFirstByteBudget(body)).toBe(5000);
    setFirstByteBudget(body, undefined);
    expect(getFirstByteBudget(body)).toBeUndefined();
  });
});

describe("awaitFirstChunk", () => {
  afterEach(() => vi.useRealTimers());

  it("passes every byte through, in order, when the first chunk is on time", async () => {
    const res = upstream([{ at: 5, text: "data: 1\n\n" }, { at: 15, text: "data: 2\n\n" }]);
    const guarded = await awaitFirstChunk(res, 500);
    expect(guarded.ok).toBe(true);
    if (!guarded.ok) return;
    expect(guarded.response.status).toBe(200);
    expect(guarded.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await guarded.response.text()).toBe("data: 1\n\ndata: 2\n\n");
  });

  it("gives up and cancels the upstream when no byte arrives in time", async () => {
    const onCancel = vi.fn();
    const res = upstream([{ at: 400, text: "late" }], onCancel);
    const started = Date.now();
    const guarded = await awaitFirstChunk(res, 30);
    expect(guarded.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(300);
    expect(onCancel).toHaveBeenCalled();
  });

  it("treats an upstream that ends empty as on time (not a timeout)", async () => {
    const res = new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 });
    const guarded = await awaitFirstChunk(res, 100);
    expect(guarded.ok).toBe(true);
  });

  it("propagates an upstream error to the reader instead of hiding it", async () => {
    const res = new Response(new ReadableStream({ start: (c) => c.error(new Error("boom")) }), { status: 200 });
    const guarded = await awaitFirstChunk(res, 100);
    expect(guarded.ok).toBe(true);
    if (!guarded.ok) return;
    await expect(guarded.response.text()).rejects.toThrow("boom");
  });

  it("is a no-op for a bodiless response", async () => {
    const guarded = await awaitFirstChunk(new Response(null, { status: 204 }), 50);
    expect(guarded.ok).toBe(true);
  });
});
