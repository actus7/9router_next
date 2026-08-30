export default {
  id: "agnes",
  alias: "agn",
  display: {
    name: "Agnes AI",
    icon: "psychology",
    color: "#8B5CF6",
    textIcon: "AG",
    website: "https://platform.agnes-ai.com",
    notice: {
      text: "$0/token promotional pricing. Free key from platform.agnes-ai.com, no card.",
      apiKeyUrl: "https://platform.agnes-ai.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  models: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash" },
    { id: "agnes-2.0-pro", name: "Agnes 2.0 Pro" },
  ],
  modelsFetcher: { url: "https://apihub.agnes-ai.com/v1/models", type: "openai" },
};
