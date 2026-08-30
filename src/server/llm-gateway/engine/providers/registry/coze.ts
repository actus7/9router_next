export default {
  id: "coze",
  alias: "coze",
  display: {
    name: "Coze",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "CZ",
    website: "https://www.coze.com",
    notice: {
      apiKeyUrl: "https://www.coze.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.coze.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.coze.com/v1/models",
  },
  models: [
    { id: "claude-3-7-sonnet-20250514", name: "Claude 3.7 Sonnet" },
  ],
};
