export default {
  id: "tokenreply",
  alias: "tokenreply",
  display: {
    name: "TokenReply",
    icon: "bolt",
    color: "#6366F1",
    textIcon: "TR",
    website: "https://tokenreply.com",
    notice: {
      apiKeyUrl: "https://tokenreply.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.tokenreply.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.tokenreply.com/v1/models",
    modelsFetcher: { url: "https://api.tokenreply.com/v1/models", type: "openai" },
  },
  models: [],
};
