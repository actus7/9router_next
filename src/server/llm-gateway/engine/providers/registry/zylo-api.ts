export default {
  id: "zylo-api",
  alias: "zylo",
  display: {
    name: "Zylo API",
    icon: "bolt",
    color: "#8B5CF6",
    textIcon: "ZY",
    website: "https://zyloai.net",
    notice: {
      apiKeyUrl: "https://zyloai.net",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.zyloai.net/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.zyloai.net/v1/models",
  },
  modelsFetcher: { url: "https://api.zyloai.net/v1/models", type: "openai" },
};
