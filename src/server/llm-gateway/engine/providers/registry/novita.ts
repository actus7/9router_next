export default {
  id: "novita",
  alias: "novita",
  display: {
    name: "Novita AI",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "NV",
    website: "https://novita.ai",
    notice: {
      apiKeyUrl: "https://novita.ai/settings/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.novita.ai/openai/v1/models",
  },
  modelsFetcher: { url: "https://api.novita.ai/openai/v1/models", type: "openai" },
};
