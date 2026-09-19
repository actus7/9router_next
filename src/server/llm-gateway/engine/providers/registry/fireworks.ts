export default {
  id: "fireworks",
  priority: 50,
  alias: "fireworks",
  display: {
    name: "Fireworks AI",
    icon: "local_fire_department",
    color: "#7B2EF2",
    textIcon: "FW",
    website: "https://fireworks.ai",
    notice: {
      apiKeyUrl: "https://fireworks.ai/account/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
    validateUrl: "https://api.fireworks.ai/inference/v1/models",
  },
    modelOverrides: {
    "nomic-ai/nomic-embed-text-v1.5": { "kind": "embedding" },
  },
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://api.fireworks.ai/inference/v1/embeddings" },
};
