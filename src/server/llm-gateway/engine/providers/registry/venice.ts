export default {
  id: "venice",
  priority: 115,
  alias: "venice",
  aliases: [
    "vn",
  ],
  uiAlias: "venice",
  display: {
    name: "Venice AI",
    icon: "shield",
    color: "#DC2626",
    textIcon: "VE",
    website: "https://venice.ai",
    notice: {
      text: "OpenAI-compatible. Private inference + uncensored models (Venice Uncensored, GLM, Qwen, DeepSeek, Llama).",
      apiKeyUrl: "https://venice.ai/settings/api",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.venice.ai/api/v1/chat/completions",
    validateUrl: "https://api.venice.ai/api/v1/models",
    thinkingFormat: "openai",
  },
  // Curated seed; the full live catalogue (90+ text models) is fetched via
  // modelsFetcher and any other id is accepted via passthroughModels.
    modelOverrides: {
    "text-embedding-3-large": { "kind": "embedding" },
    "text-embedding-bge-m3": { "kind": "embedding" },
    "text-embedding-qwen3-8b": { "kind": "embedding" },
    "venice-sd35": { "params": ["n", "size"], "kind": "image" },
    "flux-2-pro": { "params": ["n", "size"], "kind": "image" },
    "gpt-image-2": { "params": ["n", "size", "quality"], "kind": "image" },
  },
  serviceKinds: ["llm", "embedding", "image"],
  embeddingConfig: {
    baseUrl: "https://api.venice.ai/api/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  imageConfig: {
    baseUrl: "https://api.venice.ai/api/v1/images/generations",
  },
  modelsFetcher: { url: "https://api.venice.ai/api/v1/models", type: "openai" },
  passthroughModels: true,
};
