export default {
  id: "llmgateway",
  alias: "llmgw",
  display: {
    name: "LLM Gateway",
    icon: "bolt",
    color: "#A855F7",
    textIcon: "GW",
    website: "https://llmgateway.io",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.llmgateway.io/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.llmgateway.io/v1/models",
    modelsFetcher: { url: "https://api.llmgateway.io/v1/models", type: "openai" },
  },
  models: [],
};
