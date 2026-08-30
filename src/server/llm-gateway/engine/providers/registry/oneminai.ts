export default {
  id: "oneminai",
  alias: "onemin",
  aliases: ["1minai", "1min"],
  display: {
    name: "1min.AI",
    icon: "timer",
    color: "#F59E0B",
    textIcon: "1M",
    website: "https://1min.ai",
    notice: {
      text: "1min.AI — proprietary API with single prompt string + SSE. May require custom executor.",
      apiKeyUrl: "https://1min.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.1min.ai/v1/chat/completions",
  },
  models: [
    { id: "onemin-default", name: "1min Default" },
  ],
  modelsFetcher: { url: "https://api.1min.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
