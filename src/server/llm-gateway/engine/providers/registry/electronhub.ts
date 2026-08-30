export default {
  id: "electronhub",
  alias: "ehub",
  display: {
    name: "ElectronHub",
    icon: "bolt",
    color: "#EAB308",
    textIcon: "EH",
    website: "https://electronhub.ai",
    notice: {
      apiKeyUrl: "https://electronhub.ai",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.electronhub.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.electronhub.ai/v1/models",
    modelsFetcher: { url: "https://api.electronhub.ai/v1/models", type: "openai" },
  },
  models: [],
};
