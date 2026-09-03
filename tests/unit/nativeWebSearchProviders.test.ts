import { describe, expect, it } from "vitest";
import { buildSearchRequest } from "@/server/llm-gateway/engine/handlers/search/callers";
import { normalizeSearchResponse } from "@/server/llm-gateway/engine/handlers/search/normalizers";
import anysearch from "@/server/llm-gateway/engine/providers/registry/anysearch";
import context7 from "@/server/llm-gateway/engine/providers/registry/context7";

const params = {
  query: "next.js app router",
  searchType: "web",
  maxResults: 5,
};

// Both providers advertise serviceKinds ["webSearch"] and show up in
// /api/v1/models/web, so /v1/search has to be able to actually serve them.
describe("AnySearch as a native /v1/search provider", () => {
  it("declares a keyless dedicated search config", () => {
    const config = (anysearch as { searchConfig?: Record<string, unknown> }).searchConfig;
    expect(config).toBeDefined();
    expect(config!.authType).toBe("none");
  });

  it("builds a POST search request against its own API", () => {
    const config = (anysearch as unknown as { searchConfig: Record<string, unknown> }).searchConfig;
    const { url, init } = buildSearchRequest({ id: "anysearch", ...config } as { id: string; baseUrl: string }, params);

    expect(url).toContain("anysearch.com");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: params.query });
  });

  it("normalizes its envelope into unified results", () => {
    const normalized = normalizeSearchResponse(
      "anysearch",
      { code: 0, data: { results: [{ title: "T", url: "https://example.com/a", snippet: "S" }] } },
      params.query,
      "web",
    );

    expect(normalized.results).toHaveLength(1);
    expect(normalized.results[0]).toMatchObject({ title: "T", url: "https://example.com/a", snippet: "S" });
  });
});

describe("Context7 as a native /v1/search provider", () => {
  it("declares a keyless dedicated search config", () => {
    const config = (context7 as { searchConfig?: Record<string, unknown> }).searchConfig;
    expect(config).toBeDefined();
    expect(config!.authType).toBe("none");
  });

  it("builds a GET request carrying the query", () => {
    const config = (context7 as unknown as { searchConfig: Record<string, unknown> }).searchConfig;
    const { url, init } = buildSearchRequest({ id: "context7", ...config } as { id: string; baseUrl: string }, params);

    expect(init.method).toBe("GET");
    expect(new URL(url).searchParams.get("query")).toBe(params.query);
  });

  it("maps library ids to their documentation URLs and rejects malformed ids", () => {
    const normalized = normalizeSearchResponse(
      "context7",
      {
        results: [
          { id: "/vercel/next.js", title: "Next.js", description: "React framework" },
          { id: "https://evil.example.com/x", title: "bad", description: "off-site id" },
        ],
      },
      params.query,
      "web",
    );

    expect(normalized.results).toHaveLength(1);
    expect(normalized.results[0]).toMatchObject({
      title: "Next.js",
      url: "https://context7.com/vercel/next.js",
      snippet: "React framework",
    });
  });
});
