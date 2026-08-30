export default {
  id: "sumopod",
  alias: "sumopod",
  display: {
    name: "SumoPod",
    icon: "bolt",
    color: "#F97316",
    textIcon: "SP",
    website: "https://sumopod.com",
    notice: {
      apiKeyUrl: "https://sumopod.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://ai.sumopod.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://ai.sumopod.com/v1/models",
  },
  modelsFetcher: { url: "https://ai.sumopod.com/v1/models", type: "openai" },
};
