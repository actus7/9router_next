export default {
  id: "aion",
  alias: "aion",
  display: {
    name: "Aion Labs",
    icon: "hub",
    color: "#3B82F6",
    textIcon: "AL",
    website: "https://aionlabs.ai",
    notice: {
      text: "Free key from aionlabs.ai, no card. Recurring free availability is catalog-managed.",
      apiKeyUrl: "https://aionlabs.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.aionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.aionlabs.ai/v1/models",
  },
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
  ],
  modelsFetcher: { url: "https://api.aionlabs.ai/v1/models", type: "openai" },
};
