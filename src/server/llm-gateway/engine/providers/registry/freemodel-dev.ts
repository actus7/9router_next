export default {
  id: "freemodel-dev",
  alias: "fmd",
  display: {
    name: "FreeModel.dev",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "FM",
    website: "https://freemodel.dev",
    notice: {
      apiKeyUrl: "https://freemodel.dev",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.freemodel.dev/v1/models",
  },
  modelsFetcher: { url: "https://api.freemodel.dev/v1/models", type: "openai" },
};
