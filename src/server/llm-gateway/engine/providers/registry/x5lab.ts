export default {
  id: "x5lab",
  alias: "x5lab",
  display: {
    name: "X5Lab",
    icon: "bolt",
    color: "#14B8A6",
    textIcon: "X5",
    website: "https://x5lab.dev",
    notice: {
      apiKeyUrl: "https://x5lab.dev",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.x5lab.dev/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.x5lab.dev/v1/models",
    modelsFetcher: { url: "https://api.x5lab.dev/v1/models", type: "openai" },
  },
  models: [],
};
