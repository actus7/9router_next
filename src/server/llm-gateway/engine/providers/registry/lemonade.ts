export default {
  id: "lemonade",
  alias: "lemonade",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "Lemonade Server",
    icon: "local_cafe",
    color: "#FBBF24",
    textIcon: "LMN",
    notice: "Lemonade Server local",
  },
  transport: {
    baseUrl: "http://localhost:13305/api/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:13305/api/v1/models", type: "openai" },
  },
};
