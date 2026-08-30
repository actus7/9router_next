export default {
  id: "yi",
  alias: "yi",
  display: {
    name: "Yi",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "YI",
    website: "https://lingyiwanwu.com",
    notice: {
      apiKeyUrl: "https://lingyiwanwu.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.lingyiwanwu.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "yi-large", name: "Yi Large" },
  ],
};
