import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());

vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({ proxyAwareFetch }));

import { BaseExecutor } from "@/server/llm-gateway/engine/executors/base";

class Probe extends BaseExecutor {
  constructor() {
    super("probe", { baseUrl: "https://example.test" });
  }
  buildUrl() {
    return "https://example.test/v1/chat/completions";
  }
}

function respond(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

async function run() {
  return new Probe().execute({
    model: "m",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: {},
  } as never);
}

// opencode answered 200 with its own marketing page for months: the endpoint
// had moved and the SPA catch-all rendered fine, so the chat received markup
// as a successful reply and nothing logged an error or fell back.
describe("HTML passed off as a completion", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("refuses a 200 whose body is an HTML page", async () => {
    proxyAwareFetch.mockResolvedValue(respond("<!DOCTYPE html><html></html>", 200, "text/html"));

    const { response } = await run();
    const payload = await response.json() as { error: { code: string; type: string } };

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe("ERR_HTML_RESPONSE");
    expect(payload.error.type).toBe("upstream_contract_changed");
  });

  it("leaves a real completion alone", async () => {
    proxyAwareFetch.mockResolvedValue(respond('{"choices":[]}', 200, "application/json"));

    const { response } = await run();

    expect(response.status).toBe(200);
  });

  it("leaves an HTML error page on the error path it already had", async () => {
    // Only 2xx is judged: a 500 rendered as a page is still an upstream error,
    // and rewriting its status would hide what actually happened.
    proxyAwareFetch.mockResolvedValue(respond("<html>gateway down</html>", 500, "text/html"));

    const { response } = await run();

    expect(response.status).toBe(500);
  });
});
