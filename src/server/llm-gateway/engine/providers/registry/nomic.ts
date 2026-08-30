export default {
  id: "nomic",
  alias: "nomic",
  display: {
    name: "Nomic",
    icon: "data_array",
    color: "#7C3AED",
    textIcon: "NM",
    website: "https://atlas.nomic.ai",
    notice: {
      apiKeyUrl: "https://atlas.nomic.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "nomic-embed-text", name: "Nomic Embed Text", kind: "embedding" },
  ],
  serviceKinds: ["embedding"],
  embeddingConfig: {
    baseUrl: "https://api.nomic.ai/v1/embedding",
  },
};
