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
    { id: "nomic-embed-text-v1.5", name: "Nomic Embed Text v1.5", kind: "embedding" },
    { id: "nomic-embed-text-v1", name: "Nomic Embed Text v1", kind: "embedding" },
  ],
  serviceKinds: ["embedding"],
  embeddingConfig: {
    baseUrl: "https://api-atlas.nomic.ai/v1/embedding/text",
  },
};
