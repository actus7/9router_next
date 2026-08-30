export default {
  id: "chenzk",
  alias: "chenzk",
  display: {
    name: "Chenzk",
    icon: "bolt",
    color: "#14B8A6",
    textIcon: "CZ",
    website: "https://chenzk.top",
    notice: {
      apiKeyUrl: "https://chenzk.top",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://chenzk.top/v1/chat/completions",
    format: "openai",
    validateUrl: "https://chenzk.top/v1/models",
    modelsFetcher: { url: "https://chenzk.top/v1/models", type: "openai" },
  },
  models: [],
};
