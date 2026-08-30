export default {
  id: "free-ai",
  alias: "freeai",
  aliases: ["freeai"],
  display: {
    name: "Free AI",
    icon: "free_cancellation",
    color: "#22C55E",
    textIcon: "FA",
    website: "https://free.ai",
    notice: {
      text: "Free: 30K tokens/day (self-hosted). URL uses /v1/chat/ instead of /v1/chat/completions.",
      apiKeyUrl: "https://free.ai/dashboard/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.free.ai/v1/chat/completions",
  },
  models: [
    { id: "free-ai-default", name: "Free AI Default" },
  ],
  passthroughModels: true,
};
