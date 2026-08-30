export default {
  id: "codestral",
  alias: "codestral",
  display: {
    name: "Codestral",
    icon: "bolt",
    color: "#FF6B35",
    textIcon: "CD",
    website: "https://codestral.mistral.ai",
    notice: {
      apiKeyUrl: "https://codestral.mistral.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://codestral.mistral.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://codestral.mistral.ai/v1/models",
  },
  models: [
    { id: "codestral-2508", name: "Codestral 2508" },
    { id: "codestral-latest", name: "Codestral Latest" },
  ],
};
