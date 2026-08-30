export default {
  id: "meganova-ai",
  alias: "meganova",
  display: {
    name: "Meganova AI",
    icon: "bolt",
    color: "#EC4899",
    textIcon: "MG",
    website: "https://meganova.ai",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.meganova.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.meganova.ai/v1/models",
    modelsFetcher: { url: "https://api.meganova.ai/v1/models", type: "openai" },
  },
  models: [],
};
