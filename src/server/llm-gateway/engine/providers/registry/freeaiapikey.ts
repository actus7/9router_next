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
    modelsFetcher: { url: "https://api.freeaiapikey.com/v1/models", type: "openai" },
  },
  models: [
    { id: "openai/gpt-4o", name: "GPT 4o" },
    { id: "openai/gpt-5.4", name: "GPT 5.4" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  ],
};
