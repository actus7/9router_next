// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model: string, creds: Record<string, unknown>) => {
    const rawBaseUrl = ((creds as Record<string, unknown>).providerSpecificData as Record<string, unknown>)?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = String(rawBaseUrl).replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
};
