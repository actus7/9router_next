// Nomic Atlas embeddings — POST {model, texts, task_type}; the OpenAI {input} body is not read by Nomic.
import { bearerAuth } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

// ponytail: task_type fixed to search_document; add a param when a caller needs search_query.
const TASK_TYPE = "search_document";

const baseUrl = (): string => String((PROVIDER_MEDIA.nomic?.embeddingConfig as Record<string, unknown>)?.baseUrl);

export default {
  buildUrl: () => baseUrl(),
  buildHeaders: (creds: Record<string, unknown>) => ({ "Content-Type": "application/json", ...bearerAuth(creds) }),
  // ponytail: dimensions not forwarded; Nomic's support for it is unverified.
  buildBody: (model: string, { input }: { input: unknown }) => ({
    model,
    texts: Array.isArray(input) ? input.map(String) : [String(input)],
    task_type: TASK_TYPE,
  }),
  normalize: (responseBody: Record<string, unknown>, model: string, { encoding_format }: { encoding_format?: unknown } = {}) => {
    const vectors = Array.isArray(responseBody.embeddings) ? (responseBody.embeddings as number[][]) : [];
    let data: Record<string, unknown>[] = vectors.map((embedding, index) => ({ object: "embedding", index, embedding }));
    // OpenAI's base64 is the raw little-endian float32 bytes; Nomic only returns float arrays.
    if (encoding_format === "base64") {
      data = data.map((item) => ({ ...item, embedding: Buffer.from(new Float32Array(item.embedding as number[]).buffer).toString("base64") }));
    }
    const total = Number((responseBody.usage as Record<string, unknown> | undefined)?.total_tokens) || 0;
    return { object: "list", data, model, usage: { prompt_tokens: total, completion_tokens: 0, total_tokens: total } };
  },
};
