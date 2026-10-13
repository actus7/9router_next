import { describe, expect, it } from "vitest";

import { servesJson } from "@/server/llm-gateway/engine/handlers/chatCore/phases";

/**
 * Kilo answers a request with no `stream` field in plain JSON. The gateway
 * defaults such a request to streaming, so it piped the JSON through the SSE
 * transform, which found no events and recorded no usage: the client got its
 * answer and the request never reached accounting — or a member's budget.
 */
describe("servesJson", () => {
  it("serves a non-streaming request as JSON", () => {
    expect(servesJson({ stream: false, clientRequestedStreaming: false, upstreamContentType: "text/event-stream" })).toBe(true);
  });

  it("serves plain JSON as JSON when the client never asked for SSE", () => {
    expect(servesJson({ stream: true, clientRequestedStreaming: false, upstreamContentType: "application/json; charset=utf-8" })).toBe(true);
  });

  it("keeps streaming an SSE upstream, and anything the client asked to stream", () => {
    expect(servesJson({ stream: true, clientRequestedStreaming: false, upstreamContentType: "text/event-stream" })).toBe(false);
    expect(servesJson({ stream: true, clientRequestedStreaming: true, upstreamContentType: "application/json" })).toBe(false);
  });
});
