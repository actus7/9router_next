export default {
  id: "speka",
  alias: "speka",
  display: {
    name: "Speka",
    icon: "bolt",
    color: "#8B5CF6",
    textIcon: "SK",
    website: "https://speka.me",
    notice: {
      apiKeyUrl: "https://speka.me",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://speka.me/v1/chat/completions",
    format: "openai",
    validateUrl: "https://speka.me/v1/models",
  },
  modelsFetcher: { url: "https://speka.me/v1/models", type: "openai" },
};
