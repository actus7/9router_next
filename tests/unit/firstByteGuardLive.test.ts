import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awaitFirstChunk } from "@/server/llm-gateway/engine/utils/firstByteGuard";

// A real socket, not an in-memory stream: the point is that giving up on a
// silent upstream actually closes the connection.
let server: http.Server;
let base = "";
let closedSlow = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    if (req.url === "/slow") {
      req.on("close", () => { closedSlow = true; });
      setTimeout(() => res.write("data: late\n\n"), 2000);
      return;
    }
    setTimeout(() => { res.write("data: a\n\n"); setTimeout(() => res.end("data: b\n\n"), 20); }, 40);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("awaitFirstChunk against a real HTTP upstream", () => {
  it("replays a first byte that arrives inside the budget", async () => {
    const guarded = await awaitFirstChunk(await fetch(`${base}/fast`), 1000);
    expect(guarded.ok).toBe(true);
    if (guarded.ok) expect(await guarded.response.text()).toBe("data: a\n\ndata: b\n\n");
  });

  it("gives up on a silent upstream and closes its socket", async () => {
    const started = Date.now();
    const guarded = await awaitFirstChunk(await fetch(`${base}/slow`), 150);
    expect(guarded.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 200));
    expect(closedSlow).toBe(true);
  });
});
