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
  models: [
    { id: "reka-flash-3", name: "Reka Flash 3" },
    { id: "reka-edge-2603", name: "Reka Edge 2603" },
  ],
  modelsFetcher: { url: "https://api.reka.ai/v1/models", type: "openai" },
};
