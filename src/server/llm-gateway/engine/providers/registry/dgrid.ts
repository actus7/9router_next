export default {
  id: "dgrid",
  alias: "dgrid",
  display: {
    name: "DGrid",
    icon: "bolt",
    color: "#059669",
    textIcon: "DG",
    website: "https://dgrid.ai",
    notice: {
      apiKeyUrl: "https://dgrid.ai",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.dgrid.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.dgrid.ai/v1/models",
    modelsFetcher: { url: "https://api.dgrid.ai/v1/models", type: "openai" },
  },
  models: [
    { id: "dgridai/free", name: "DGrid Free" },
  ],
};
