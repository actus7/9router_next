export default {
  id: "lm-studio",
  alias: "lms",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "LM Studio",
    icon: "computer",
    color: "#6366F1",
    textIcon: "LMS",
    notice: "LM Studio local server. Start with: lms server start",
  },
  transport: {
    baseUrl: "http://localhost:1234/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:1234/v1/models", type: "openai" },
  },
};
