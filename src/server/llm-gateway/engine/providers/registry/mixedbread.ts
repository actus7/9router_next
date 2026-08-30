export default {
  id: "mixedbread",
  alias: "mxbai",
  display: {
    name: "Mixedbread",
    icon: "data_array",
    color: "#D97706",
    textIcon: "MX",
    website: "https://mixedbread.ai",
    notice: {
      apiKeyUrl: "https://mixedbread.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "mxbai-embed-large", name: "Mixedbread Embed Large", kind: "embedding" },
  ],
  serviceKinds: ["embedding"],
  embeddingConfig: {
    baseUrl: "https://api.mixedbread.ai/v1/embeddings",
  },
};
