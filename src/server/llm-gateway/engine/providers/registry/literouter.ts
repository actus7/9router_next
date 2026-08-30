export default {
  id: "literouter",
  alias: "literouter",
  display: {
    name: "LiteRouter",
    icon: "bolt",
    color: "#F97316",
    textIcon: "LR",
    website: "https://literouter.com",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.literouter.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.literouter.com/v1/models",
    modelsFetcher: { url: "https://api.literouter.com/v1/models", type: "openai" },
  },
  models: [],
};
