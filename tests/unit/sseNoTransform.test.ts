import { describe, expect, it } from "vitest";
import { SSE_HEADERS, SSE_HEADERS_CORS, SSE_HEADERS_NO_BUFFER } from "@/server/llm-gateway/engine/utils/sseConstants";

// Gzip em text/event-stream segura tokens no buffer do encoder. O middleware de
// compressão do Next (e CDNs) pulam a resposta com `no-transform`.
describe("headers SSE do gateway", () => {
  it.each([
    ["SSE_HEADERS", SSE_HEADERS],
    ["SSE_HEADERS_NO_BUFFER", SSE_HEADERS_NO_BUFFER],
    ["SSE_HEADERS_CORS", SSE_HEADERS_CORS],
  ])("%s proíbe transformação", (_name, headers) => {
    expect(headers["Cache-Control"]).toBe("no-cache, no-transform");
    expect(headers["X-Accel-Buffering"]).toBe("no");
  });
});
