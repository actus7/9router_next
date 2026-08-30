export default {
  id: "kenari",
  alias: "kenari",
  display: {
    name: "Kenari",
    icon: "bolt",
    color: "#06B6D4",
    textIcon: "KN",
    website: "https://kenari.id",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://kenari.id/v1/chat/completions",
    format: "openai",
    validateUrl: "https://kenari.id/v1/models",
    modelsFetcher: { url: "https://kenari.id/v1/models", type: "openai" },
  },
  models: [],
};
