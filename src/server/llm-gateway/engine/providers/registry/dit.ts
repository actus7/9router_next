export default {
  id: "dit",
  alias: "dai",
  display: {
    name: "DIT AI",
    icon: "bolt",
    color: "#D946EF",
    textIcon: "DA",
    website: "https://dit.ai",
    notice: {
      apiKeyUrl: "https://dit.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.dit.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.dit.ai/v1/models",
    modelsFetcher: { url: "https://api.dit.ai/v1/models", type: "openai" },
  },
  models: [
    { id: "gpt-5.4", name: "GPT 5.4", contextLength: 400000 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextLength: 200000 },
  ],
};
