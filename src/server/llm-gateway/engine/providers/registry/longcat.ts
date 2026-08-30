export default {
  id: "longcat",
  alias: "lc",
  display: {
    name: "LongCat",
    icon: "pets",
    color: "#F97316",
    textIcon: "LC",
    website: "https://longcat.chat",
    notice: {
      text: "Daily free quota. Accepts signup from outside China. By Meituan.",
      apiKeyUrl: "https://longcat.chat",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.longcat.chat/openai/v1/chat/completions",
    validateUrl: "https://api.longcat.chat/openai/v1/models",
  },
  modelsFetcher: { url: "https://api.longcat.chat/openai/v1/models", type: "openai" },
};
