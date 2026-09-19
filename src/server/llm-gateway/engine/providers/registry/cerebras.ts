export default {
  id: "cerebras",
  priority: 60,
  alias: "cerebras",
  display: {
    name: "Cerebras",
    icon: "memory",
    color: "#FF4F00",
    textIcon: "CB",
    website: "https://www.cerebras.ai",
    notice: {
      apiKeyUrl: "https://cloud.cerebras.ai/platform",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    validateUrl: "https://api.cerebras.ai/v1/models",
    quirks: {
      dropClientMetadata: true,
    },
  },

};
