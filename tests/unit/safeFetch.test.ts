import { describe, expect, it, vi } from "vitest";
import { createSafePublicFetch } from "@/server/security/safeFetch";
import { createServer } from "node:http";

const PUBLIC_DNS = async () => [{ address: "93.184.216.34", family: 4 }];

describe("safePublicFetch", () => {
  it("blocks DNS answers containing a private address before opening a connection", async () => {
    const fetchImpl = vi.fn();
    const safeFetch = createSafePublicFetch({
      fetchImpl,
      resolver: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    });

    await expect(safeFetch("https://example.com/data")).rejects.toThrow(/DNS resolved to private IP/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pins the approved DNS address in the dispatcher", async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(init.dispatcher).toBeDefined();
      return new Response("ok");
    });
    const safeFetch = createSafePublicFetch({ fetchImpl, resolver: PUBLIC_DNS });

    const response = await safeFetch("https://example.com/data");
    await expect(response.text()).resolves.toBe("ok");
  });

  it("revalidates redirect destinations and blocks an internal hop", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));
    const safeFetch = createSafePublicFetch({ fetchImpl, resolver: PUBLIC_DNS });

    await expect(safeFetch("https://example.com/start")).rejects.toThrow(/private IP/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("removes credentials when a redirect changes origin", async () => {
    const seenHeaders: Headers[] = [];
    const fetchImpl = vi.fn(async (_input, init) => {
      seenHeaders.push(new Headers(init.headers));
      if (seenHeaders.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example/final" },
        });
      }
      return new Response("done");
    });
    const safeFetch = createSafePublicFetch({ fetchImpl, resolver: PUBLIC_DNS });

    const response = await safeFetch("https://example.com/start", {
      headers: { authorization: "Bearer secret", cookie: "session=secret", "x-safe": "kept" },
    });
    await response.text();

    expect(seenHeaders[0].get("authorization")).toBe("Bearer secret");
    expect(seenHeaders[1].get("authorization")).toBeNull();
    expect(seenHeaders[1].get("cookie")).toBeNull();
    expect(seenHeaders[1].get("x-safe")).toBe("kept");
  });

  it("limits redirects to three hops", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input);
      const hop = Number(url.searchParams.get("hop") ?? 0);
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/path?hop=${hop + 1}` },
      });
    });
    const safeFetch = createSafePublicFetch({ fetchImpl, resolver: PUBLIC_DNS });

    await expect(safeFetch("https://example.com/path?hop=0")).rejects.toThrow(/Too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("allows loopback only when trusted-local is explicitly selected", async () => {
    const fetchImpl = vi.fn(async () => new Response("local"));
    const resolver = async () => [{ address: "127.0.0.1", family: 4 }];
    const safeFetch = createSafePublicFetch({ fetchImpl, resolver });

    await expect(safeFetch("http://127.0.0.1:11434/api")).rejects.toThrow(/private IP/);
    const response = await safeFetch("http://127.0.0.1:11434/api", {
      destinationPolicy: "trusted-local",
    });
    await expect(response.text()).resolves.toBe("local");
  });

  it("rejects unsupported protocols, credentials, and empty DNS answers", async () => {
    const fetchImpl = vi.fn();
    const emptyDnsFetch = createSafePublicFetch({ fetchImpl, resolver: async () => [] });
    await expect(emptyDnsFetch("ftp://example.com/file")).rejects.toThrow(/unsupported protocol/);
    await expect(emptyDnsFetch("https://user:secret@example.com/file")).rejects.toThrow(/embedded credentials/);
    await expect(emptyDnsFetch("https://example.com/file")).rejects.toThrow(/no addresses/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the system resolver and pinned connector for an explicitly trusted loopback", async () => {
    const server = createServer((_request, response) => response.end("pinned"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    try {
      const response = await createSafePublicFetch()(`http://127.0.0.1:${address.port}/`, {
        destinationPolicy: "trusted-local",
      });
      await expect(response.text()).resolves.toBe("pinned");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  // The loopback case above passes an IP literal, so `node:net` skips DNS entirely
  // and never exercises the pin. Going through a hostname is what actually invokes
  // the pinned connector, which is how a broken callback contract reaches production
  // as an opaque "fetch failed".
  it("connects through the pinned connector when the host needs resolution", async () => {
    const server = createServer((_request, response) => response.end("resolved"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    try {
      const safeFetch = createSafePublicFetch({
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      });
      const response = await safeFetch(`http://localhost:${address.port}/`, {
        destinationPolicy: "trusted-local",
      });
      await expect(response.text()).resolves.toBe("resolved");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("handles bodyless responses and closes a cancelled response body", async () => {
    const bodyless = createSafePublicFetch({
      resolver: PUBLIC_DNS,
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    expect((await bodyless("https://example.com/no-content")).status).toBe(204);

    const streaming = createSafePublicFetch({
      resolver: PUBLIC_DNS,
      fetchImpl: async () => new Response(new ReadableStream({ pull() {} })),
    });
    const response = await streaming("https://example.com/stream");
    await response.body?.cancel("test complete");
  });

  it("propagates transport and response-stream failures", async () => {
    const transportFailure = createSafePublicFetch({
      resolver: PUBLIC_DNS,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    await expect(transportFailure("https://example.com", { signal: new AbortController().signal })).rejects.toThrow("network down");

    const streamFailure = createSafePublicFetch({
      resolver: PUBLIC_DNS,
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) { controller.error(new Error("stream failed")); },
      })),
    });
    const response = await streamFailure("https://example.com");
    await expect(response.text()).rejects.toThrow("stream failed");
  });

  it("converts a redirected POST to GET and removes entity headers", async () => {
    const seen: RequestInit[] = [];
    const safeFetch = createSafePublicFetch({
      resolver: PUBLIC_DNS,
      fetchImpl: async (_input, init) => {
        seen.push(init);
        return seen.length === 1
          ? new Response(null, { status: 303, headers: { location: "/result" } })
          : new Response("ok");
      },
    });
    const response = await safeFetch("https://example.com/start", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "2" },
      body: "{}",
    });
    await response.text();
    expect(seen[1].method).toBe("GET");
    expect(new Headers(seen[1].headers).has("content-type")).toBe(false);
    expect(seen[1].body).toBeUndefined();
  });
});
