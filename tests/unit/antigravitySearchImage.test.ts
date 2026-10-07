import { describe, expect, it, vi } from "vitest";

/**
 * Antigravity web search (Google Search grounding through the OAuth account) and
 * the image adapter's model/size handling — both ported from upstream decolua/9router.
 */
const safePublicFetch = vi.hoisted(() => vi.fn());
vi.mock("@/server/security/safeFetch", () => ({ safePublicFetch }));

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/server/llm-gateway/engine/executors/index", () => ({ getExecutor: () => ({ execute }) }));

import { handleChatSearch } from "@/server/llm-gateway/engine/handlers/search/chatSearch";
import imageAdapter from "@/server/llm-gateway/engine/handlers/imageProviders/antigravity";

describe("antigravity web search", () => {
  it("refuses an account with no projectId before calling upstream", async () => {
    const result = await handleChatSearch({ provider: "antigravity", query: "q", credentials: { accessToken: "at" } });

    expect(result).toMatchObject({ success: false, status: 401 });
    expect(safePublicFetch).not.toHaveBeenCalled();
  });

  it("sends the search envelope and merges repeated sources into one citation", async () => {
    const payload = {
      response: {
        candidates: [{
          content: { parts: [{ text: "Alpha is a letter. Beta is another." }] },
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://a.test", title: "A" } }, { web: { uri: "https://a.test", title: "A" } }],
            groundingSupports: [{ segment: { text: "Alpha is a letter.", startIndex: 0, endIndex: 18 }, groundingChunkIndices: [0, 1] }],
          },
        }],
        usageMetadata: { totalTokenCount: 7 },
      },
    };
    safePublicFetch.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const result = (await handleChatSearch({ provider: "antigravity", query: "alpha", credentials: { accessToken: "at", projectId: "p-1" } })) as { success: boolean; data?: { results: Array<{ url: string; content: string }> } };

    const sent = JSON.parse(safePublicFetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({ project: "p-1", requestType: "search", userAgent: "antigravity" });
    expect(sent.request.tools).toEqual([{ googleSearch: {} }]);
    expect(result.success).toBe(true);
    expect(result.data?.results).toHaveLength(1);
    expect(result.data?.results[0].content).toContain("Alpha is a letter.");
  });
});

describe("antigravity image adapter", () => {
  const run = async (model: string, body: Record<string, unknown>) => {
    execute.mockResolvedValue({ response: new Response("{}", { status: 200 }) });
    await imageAdapter.executeViaExecutor(model, { prompt: "p", ...body }, {});
    return execute.mock.calls.at(-1)![0].model as string;
  };

  it("falls back to the image model when the requested one is not an image model", async () => {
    expect(await run("gemini-3.7-flash-high", {})).toBe("gemini-3.1-flash-image");
  });

  it("appends the aspect ratio derived from size", async () => {
    expect(await run("gemini-3.1-flash-image", { size: "1792x1024" })).toBe("gemini-3.1-flash-image-16x9");
  });
});
