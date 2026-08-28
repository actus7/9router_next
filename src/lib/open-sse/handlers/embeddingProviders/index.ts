// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai";
import gemini from "./gemini";
import openaiCompatNode from "./openaiCompatNode";
import selfhostedEmbedding from "./selfhostedEmbedding";

const OPENAI_COMPAT_PROVIDERS = [
  "openai", "openrouter", "mistral", "voyage-ai", "fireworks",
  "together", "nebius", "github", "nvidia", "jina-ai",
  "vercel-ai-gateway",
];

interface EmbeddingAdapter {
  buildUrl: (model: string, creds: Record<string, unknown>, ctx?: { input?: unknown }) => string;
  buildHeaders: (creds: Record<string, unknown>, ctx?: { input?: unknown }) => Record<string, string>;
  buildBody: (model: string, params: Record<string, unknown>) => Record<string, unknown>;
  normalize: (responseBody: Record<string, unknown>, model: string) => Record<string, unknown>;
}

const ADAPTERS: Record<string, EmbeddingAdapter> = {
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
  gemini: gemini as unknown as EmbeddingAdapter,
  google_ai_studio: gemini as unknown as EmbeddingAdapter,
  // Self-hosted reads creds.providerSpecificData.baseUrl (one provider, many
  // servers) — but via its OWN adapter, not openaiCompatNode: that one falls back
  // to api.openai.com when no baseUrl is set, which under a provider called
  // "Self-hosted Embedding" means silently shipping the input and API key to
  // OpenAI. selfhostedEmbedding refuses instead.
  "selfhosted-embedding": selfhostedEmbedding as unknown as EmbeddingAdapter,
};

export function getEmbeddingAdapter(provider: string): EmbeddingAdapter | null {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode as unknown as EmbeddingAdapter;
  }
  return null;
}
