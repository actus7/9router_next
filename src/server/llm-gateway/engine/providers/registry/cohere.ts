export default {
  id: "cohere",
  priority: 90,
  alias: "cohere",
  display: {
    name: "Cohere",
    icon: "hub",
    color: "#39594D",
    textIcon: "CO",
    website: "https://cohere.com",
    notice: {
      apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    },
  },
  category: "apikey",
  transport: {
    // Cohere's native v1 API is not OpenAI Chat Completions compatible.
    // Chat traffic must use its dedicated OpenAI compatibility surface.
    baseUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
    validateUrl: "https://api.cohere.ai/v1/models",
  },

};
