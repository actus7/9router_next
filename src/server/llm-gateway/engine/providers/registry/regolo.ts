export default {
  id: "regolo",
  alias: "regolo",
  display: {
    name: "Regolo",
    icon: "bolt",
    color: "#14B8A6",
    textIcon: "RG",
    website: "https://regolo.ai",
    notice: {
      apiKeyUrl: "https://regolo.ai",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.regolo.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.regolo.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.regolo.ai/v1/models", type: "openai" },
};
