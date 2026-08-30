export default {
  id: "dify",
  alias: "dify",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://dify.ai",
  display: {
    name: "Dify",
    icon: "smart_toy",
    color: "#8B5CF6",
    textIcon: "DF",
    website: "https://dify.ai",
    notice: {
      apiKeyUrl: "https://dify.ai",
      customEndpoint: "Dify uses a custom API endpoint (/v1/chat-messages). May require custom executor.",
    },
  },
  transport: {
    baseUrl: "https://api.dify.ai/v1/chat-messages",
  },
  models: [
    { id: "dify-default", name: "Dify Default" },
  ],
};
