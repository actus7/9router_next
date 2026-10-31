import { afterEach, describe, expect, it, vi } from "vitest";

import { handleEmbeddingsCore } from "@/server/llm-gateway/engine/handlers/embeddingsCore";
import { getEmbeddingAdapter } from "@/server/llm-gateway/engine/handlers/embeddingProviders/index";

// Nomic moved from api.nomic.ai/v1/embedding (retired, TLS handshake fails) to
// api-atlas.nomic.ai/v1/embedding/text, and its body is {model, texts, task_type}
// rather than the OpenAI {model, input}.
function mockNomicFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof mockNomicFetch>): Record<string, unknown> {
  const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nomic embeddings", () => {
  it("has an adapter registered for the nomic provider", () => {
    expect(getEmbeddingAdapter("nomic")).not.toBeNull();
  });

  it("posts to the atlas text endpoint with a bearer key and the documented body", async () => {
    const fetchMock = mockNomicFetch({ embeddings: [[0.1, 0.2]], usage: { total_tokens: 3 } });

    await handleEmbeddingsCore({
      body: { model: "nomic-embed-text-v1.5", input: "hello" },
      modelInfo: { provider: "nomic", model: "nomic-embed-text-v1.5" },
      credentials: { apiKey: "nk-test" },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://api-atlas.nomic.ai/v1/embedding/text");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer nk-test");
    expect(sentBody(fetchMock)).toEqual({
      model: "nomic-embed-text-v1.5",
      texts: ["hello"],
      task_type: "search_document",
    });
  });

  it("sends an array input as texts, not input", async () => {
    const fetchMock = mockNomicFetch({ embeddings: [[1], [2]], usage: { total_tokens: 4 } });

    await handleEmbeddingsCore({
      body: { model: "nomic-embed-text-v1.5", input: ["a", "b"] },
      modelInfo: { provider: "nomic", model: "nomic-embed-text-v1.5" },
      credentials: { apiKey: "nk-test" },
    });

    const body = sentBody(fetchMock);
    expect(body.texts).toEqual(["a", "b"]);
    expect(body).not.toHaveProperty("input");
  });

  it("maps Nomic's embeddings and usage back to the OpenAI shape", async () => {
    mockNomicFetch({ embeddings: [[0.1, 0.2]], usage: { total_tokens: 3 } });

    const result = await handleEmbeddingsCore({
      body: { model: "nomic-embed-text-v1.5", input: "hello" },
      modelInfo: { provider: "nomic", model: "nomic-embed-text-v1.5" },
      credentials: { apiKey: "nk-test" },
    });

    if (!result.success) throw new Error(`expected success, got ${result.error}`);
    const out = await result.response.json() as { data: { embedding: number[]; index: number }[]; usage: unknown };
    expect(out.data).toEqual([{ object: "embedding", index: 0, embedding: [0.1, 0.2] }]);
    expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 });
  });
});
