export default {
  id: "auriko",
  alias: "auriko",
  display: {
    name: "Auriko",
    icon: "bolt",
    color: "#F97316",
    textIcon: "AK",
    website: "https://auriko.ai",
    notice: {
      apiKeyUrl: "https://auriko.ai",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.auriko.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.auriko.ai/v1/models",
    modelsFetcher: { url: "https://api.auriko.ai/v1/models", type: "openai" },
  },
  models: [],
};
