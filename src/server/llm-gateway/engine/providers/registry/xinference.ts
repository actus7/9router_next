export default {
  id: "xinference",
  alias: "xinference",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "Xinference",
    icon: "hub",
    color: "#06B6D4",
    textIcon: "XIN",
    notice: "Xinference local server. Start with: xinference-local",
  },
  transport: {
    baseUrl: "http://localhost:9997/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:9997/v1/models", type: "openai" },
  },
};
