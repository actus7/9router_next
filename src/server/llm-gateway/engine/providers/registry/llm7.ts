export default {
  id: "llm7",
  alias: "llm7",
  aliases: [
    "llm-7",
  ],
  uiAlias: "llm7",
  display: {
    name: "LLM7",
    icon: "pool",
    color: "#7C3AED",
    textIcon: "L7",
    website: "https://llm7.io",
    notice: {
      apiKeyUrl: "https://llm7.io",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://api.llm7.io/v1/chat/completions",
    validateUrl: "https://api.llm7.io/v1/models",
  },
  passthroughModels: true,
};
