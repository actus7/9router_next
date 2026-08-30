export default {
  id: "dahl",
  alias: "dahl",
  display: {
    name: "Dahl",
    icon: "cloud",
    color: "#0EA5E9",
    textIcon: "DH",
    website: "https://dahl.global",
    notice: {
      text: "Managed account: auto-generates tokens via /tokens endpoint. Free: MiniMax M2.7, Kimi K2.6.",
      apiKeyUrl: "https://inference.dahl.global/dashboard",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.dahl.global/v1/chat/completions",
  },
  models: [
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
  ],
  modelsFetcher: { url: "https://inference.dahl.global/v1/models", type: "openai" },
  passthroughModels: true,
};
