export default {
  id: "fastrouter",
  alias: "fr",
  display: {
    name: "FastRouter",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "FR",
    website: "https://fastrouter.ai",
    notice: {
      apiKeyUrl: "https://fastrouter.ai",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.fastrouter.ai/api/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.fastrouter.ai/api/v1/models",
  },
  modelsFetcher: { url: "https://api.fastrouter.ai/api/v1/models", type: "openai" },
};
