export default {
  id: "freeaiapikey",
  alias: "faik",
  display: {
    name: "Free AI API Key",
    icon: "bolt",
    color: "#84CC16",
    textIcon: "FA",
    website: "https://freeaiapikey.com",
    notice: {
      apiKeyUrl: "https://freeaiapikey.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.freeaiapikey.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.freeaiapikey.com/v1/models",
  },
  modelsFetcher: { url: "https://api.freeaiapikey.com/v1/models", type: "openai" },
};
