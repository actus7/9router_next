export default {
  id: "ai21",
  alias: "ai21",
  display: {
    name: "AI21 Labs",
    icon: "smart_toy",
    color: "#6366F1",
    textIcon: "A21",
    website: "https://www.ai21.com",
    notice: {
      apiKeyUrl: "https://studio.ai21.com/account/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.ai21.com/studio/v1/models",
  },
};
