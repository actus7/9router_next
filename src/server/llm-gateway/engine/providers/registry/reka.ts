export default {
  id: "reka",
  alias: "reka",
  display: {
    name: "Reka",
    icon: "visibility",
    color: "#7C3AED",
    textIcon: "RK",
    website: "https://reka.ai",
    notice: {
      text: "Recurring monthly credit, no card. Multimodal (image/video). Key from platform.reka.ai.",
      apiKeyUrl: "https://platform.reka.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    validateUrl: "https://api.reka.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.reka.ai/v1/models", type: "openai" },
};
