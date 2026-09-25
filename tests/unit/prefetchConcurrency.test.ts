import { describe, expect, it, vi } from "vitest";

/**
 * Remote images used to be fetched one after another, so a message with N
 * images paid N sequential downloads before the upstream call could start.
 */
const inFlight = vi.hoisted(() => ({ now: 0, peak: 0 }));

vi.mock("@/server/llm-gateway/engine/translator/concerns/image", () => ({
  parseDataUri: (url: string) => url.startsWith("data:"),
  fetchImageAsBase64: vi.fn(async (url: string) => {
    inFlight.now++;
    inFlight.peak = Math.max(inFlight.peak, inFlight.now);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight.now--;
    if (url.endsWith("/broken")) return null;
    return { url: `data:image/png;base64,${Buffer.from(url).toString("base64")}`, mimeType: "image/png" };
  }),
}));

import { prefetchRemoteImages } from "@/server/llm-gateway/engine/translator/concerns/prefetch";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

describe("prefetchRemoteImages", () => {
  it("fetches in parallel under a cap and writes each result back to its own block", async () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://img.test/${i}`);
    urls[3] = "https://img.test/broken";
    const body = {
      messages: [{ role: "user", content: urls.map((url) => ({ type: "image_url", image_url: { url } })) }],
    };

    const converted = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.GEMINI);

    expect(converted).toBe(8);
    expect(inFlight.peak).toBeGreaterThan(1);
    expect(inFlight.peak).toBeLessThanOrEqual(4);
    const written = body.messages[0].content.map((block) => block.image_url.url);
    urls.forEach((url, i) => {
      expect(written[i]).toBe(i === 3 ? url : `data:image/png;base64,${Buffer.from(url).toString("base64")}`);
    });
  });
});
