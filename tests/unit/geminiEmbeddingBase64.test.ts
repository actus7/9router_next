import { describe, expect, it } from "vitest";

import gemini from "@/server/llm-gateway/engine/handlers/embeddingProviders/gemini";

// OpenAI's encoding_format:"base64" is the little-endian float32 bytes of the
// vector. Gemini has no such option, so the adapter has to encode it itself.
describe("gemini embeddings encoding_format", () => {
  const body = { embeddings: [{ values: [1, -0.5] }] };

  it("returns base64 float32 when base64 was requested", () => {
    const out = gemini.normalize(body, "m", { encoding_format: "base64" }) as { data: { embedding: string }[] };
    const bytes = Buffer.from(out.data[0].embedding, "base64");
    expect(Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4))).toEqual([1, -0.5]);
  });

  it("keeps float arrays by default", () => {
    expect((gemini.normalize(body, "m") as { data: { embedding: number[] }[] }).data[0].embedding).toEqual([1, -0.5]);
  });
});
