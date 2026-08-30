export default {
  id: "cloudcode-one",
  alias: "cco",
  display: {
    name: "CloudCode",
    icon: "cloud",
    color: "#0EA5E9",
    textIcon: "CC",
    website: "https://cloudcode.one",
    notice: {
      apiKeyUrl: "https://api.cloudcode.one",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.cloudcode.one/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.cloudcode.one/v1/models",
  },
  modelsFetcher: { url: "https://api.cloudcode.one/v1/models", type: "openai" },
};
