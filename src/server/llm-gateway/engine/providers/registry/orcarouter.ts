export default {
  id: "orcarouter",
  alias: "orc",
  display: {
    name: "OrcaRouter",
    icon: "directions_boat",
    color: "#06B6D4",
    textIcon: "OR",
    website: "https://orcarouter.ai",
    notice: {
      text: "Free aliases (*-free) at $0. Free key from orcarouter.ai, no card (sk-orca- prefix).",
      apiKeyUrl: "https://orcarouter.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.orcarouter.ai/v1/chat/completions",
    validateUrl: "https://api.orcarouter.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.orcarouter.ai/v1/models", type: "openai" },
};
