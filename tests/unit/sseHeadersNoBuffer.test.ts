import { describe, expect, it } from "vitest";
import { SSE_HEADERS, SSE_HEADERS_CORS } from "@/server/llm-gateway/engine/utils/sseConstants";

// Without it a buffering proxy (nginx, some CDNs) holds the stream and the
// client sees the whole answer at once instead of token by token.
describe("SSE headers", () => {
  it("disable proxy buffering on every client-facing variant", () => {
    expect(SSE_HEADERS["X-Accel-Buffering"]).toBe("no");
    expect(SSE_HEADERS_CORS["X-Accel-Buffering"]).toBe("no");
  });
});
