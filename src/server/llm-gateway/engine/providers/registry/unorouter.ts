export default {
  id: "unorouter",
  alias: "uno",
  display: {
    name: "UnoRouter",
    icon: "swap_horiz",
    color: "#EC4899",
    textIcon: "UN",
    website: "https://unorouter.com",
    notice: {
      text: "Free models with :free suffix, 1 req/min per model. Free key from unorouter.com, no card.",
      apiKeyUrl: "https://unorouter.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.unorouter.com/v1/chat/completions",
    validateUrl: "https://api.unorouter.com/v1/models",
  },
  modelsFetcher: { url: "https://api.unorouter.com/v1/models", type: "openai" },
};
