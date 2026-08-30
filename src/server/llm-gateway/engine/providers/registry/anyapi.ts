export default {
  id: "anyapi",
  alias: "any",
  display: {
    name: "AnyAPI",
    icon: "api",
    color: "#10B981",
    textIcon: "AN",
    website: "https://anyapi.ai",
    notice: {
      text: "100K tokens/day free, no card required. Only 'free' and 'basic' models in scope.",
      apiKeyUrl: "https://anyapi.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.anyapi.ai/v1/chat/completions",
    validateUrl: "https://api.anyapi.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.anyapi.ai/v1/models", type: "openai" },
};
