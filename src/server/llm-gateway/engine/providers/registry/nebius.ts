export default {
  id: "nebius",
  priority: 70,
  alias: "nebius",
  display: {
    name: "Nebius AI",
    icon: "cloud",
    color: "#6C5CE7",
    textIcon: "NB",
    website: "https://nebius.com",
    notice: {
      apiKeyUrl: "https://studio.nebius.com/settings/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.studio.nebius.ai/v1/chat/completions",
    validateUrl: "https://api.studio.nebius.ai/v1/models",
  },
    modelOverrides: {
    "Qwen/Qwen3-Embedding-8B": { "kind": "embedding" },
  },
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://api.tokenfactory.nebius.com/v1/embeddings" },
};
