import { describe, expect, it, vi } from "vitest";

import { pipeWithDisconnect } from "@/server/llm-gateway/engine/utils/streamHandler";

describe("pipeWithDisconnect", () => {
  it("aborts a stream that sends headers but never sends its first chunk", async () => {
    const abortController = new AbortController();
    const handleError = vi.fn();
    const abort = vi.fn(() => abortController.abort());
    const source = new ReadableStream<Uint8Array>({ start() {} });
    const controller = {
      signal: abortController.signal,
      startTime: Date.now(),
      isConnected: () => true,
      handleComplete: vi.fn(),
      handleError,
      handleDisconnect: vi.fn(),
      abort,
    };

    const output = pipeWithDisconnect(
      new Response(source),
      new TransformStream<Uint8Array, Uint8Array>(),
      controller,
      null,
      1_000,
      10,
    );
    void output.getReader().read().catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: "stream first-chunk timeout" }));
    expect(abort).toHaveBeenCalledOnce();
  });
});
