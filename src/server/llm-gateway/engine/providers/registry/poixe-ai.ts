export default {
  id: "poixe-ai",
  alias: "poixe",
  display: {
    name: "Poixe AI",
    icon: "bolt",
    color: "#10B981",
    textIcon: "PX",
    website: "https://poixe.com",
    notice: {
      apiKeyUrl: "https://poixe.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.poixe.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.poixe.com/v1/models",
  },
  modelsFetcher: { url: "https://api.poixe.com/v1/models", type: "openai" },
};
