export default {
  id: "requesty",
  alias: "rq",
  display: {
    name: "Requesty",
    icon: "route",
    color: "#14B8A6",
    textIcon: "RQ",
    website: "https://requesty.ai",
    notice: {
      text: "Router with free models. Free key from requesty.ai, no card.",
      apiKeyUrl: "https://requesty.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://router.requesty.ai/v1/chat/completions",
    validateUrl: "https://router.requesty.ai/v1/models",
  },
  models: [
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
  ],
  modelsFetcher: { url: "https://router.requesty.ai/v1/models", type: "openai" },
};
