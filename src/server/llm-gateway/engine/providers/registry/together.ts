export default {
  id: "together",
  priority: 60,
  alias: "together",
  display: {
    name: "Together AI",
    icon: "group_work",
    color: "#0F6FFF",
    textIcon: "TG",
    website: "https://www.together.ai",
    notice: {
      apiKeyUrl: "https://api.together.xyz/settings/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.together.xyz/v1/chat/completions",
    validateUrl: "https://api.together.xyz/v1/models",
  },
    modelOverrides: {
    "BAAI/bge-large-en-v1.5": { "kind": "embedding" },
    "togethercomputer/m2-bert-80M-8k-retrieval": { "kind": "embedding" },
  },
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://api.together.xyz/v1/embeddings" },
};
