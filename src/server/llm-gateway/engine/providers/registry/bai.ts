export default {
  id: "bai",
  alias: "bai",
  display: {
    name: "B.AI",
    icon: "smart_toy",
    color: "#6366F1",
    textIcon: "BA",
    website: "https://b.ai",
    notice: {
      text: "Limited-time 0-credit promotion; may expire without notice.",
      apiKeyUrl: "https://b.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.b.ai/v1/chat/completions",
    validateUrl: "https://api.b.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.b.ai/v1/models", type: "openai" },
};
