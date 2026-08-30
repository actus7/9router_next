export default {
  id: "qiniu",
  alias: "qiniu",
  display: {
    name: "Qiniu",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "QN",
    website: "https://qnaigc.com",
    notice: {
      apiKeyUrl: "https://qnaigc.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.qnaigc.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.qnaigc.com/v1/models",
    modelsFetcher: { url: "https://api.qnaigc.com/v1/models", type: "openai" },
  },
  models: [],
};
