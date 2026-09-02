import { afterEach, describe, expect, it, vi } from "vitest";

import { executeChatFetch } from "@/app/(dashboard)/dashboard/basic-chat/hooks/consumeSSEStream";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("executeChatFetch", () => {
  it("keeps a final SSE data frame even when the provider omits its trailing newline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      streamFrom([
        'data: {"choices":[{"delta":{"content":"final"}}]}',
      ]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));

    const updates: string[] = [];
    const result = await executeChatFetch("/api/v1/chat/completions", {}, (text) => updates.push(text));

    expect(result.text).toBe("final");
    expect(updates).toEqual(["final"]);
  });
});
