import { describe, expect, it } from "vitest";

import { convertResponsesStreamToJson } from "@/server/llm-gateway/engine/transformer/streamToJsonConverter";

/**
 * This converter runs when a forceStream provider (Codex) answers a client that
 * asked for JSON. `pipeWithDisconnect`, which owns the stall watchdog for the
 * streaming path, is not involved — so an upstream that opens the stream and
 * then goes quiet without closing used to hang the request forever.
 */
function neverEndingStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: response.created\ndata: {"response":{"id":"resp_1"}}\n\n'));
      // and then nothing, ever — no further chunk and no close
    },
  });
}

describe("convertResponsesStreamToJson", () => {
  it("gives up on a stalled upstream instead of hanging", async () => {
    const result = await convertResponsesStreamToJson(neverEndingStream(), 50) as { status: string };
    expect(result.status).toBe("failed");
  });

  it("still reads a stream that completes normally", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: response.created\ndata: {"response":{"id":"resp_2"}}\n\n'));
        controller.enqueue(encoder.encode('event: response.completed\ndata: {"response":{"id":"resp_2","status":"completed"}}\n\n'));
        controller.close();
      },
    });
    const result = await convertResponsesStreamToJson(stream, 5_000) as { status: string; id: string };
    expect(result.status).not.toBe("failed");
  });
});
