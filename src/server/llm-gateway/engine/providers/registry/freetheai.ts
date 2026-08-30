export default {
  id: "freetheai",
  alias: "fta",
  display: {
    name: "FreeTheAI",
    icon: "bolt",
    color: "#16A34A",
    textIcon: "FT",
    website: "https://freetheai.xyz",
    notice: {
      apiKeyUrl: "https://freetheai.xyz",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.freetheai.xyz/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.freetheai.xyz/v1/models",
  },
  modelsFetcher: { url: "https://api.freetheai.xyz/v1/models", type: "openai" },
};
