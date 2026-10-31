export default {
  id: "kimi-coding-apikey",
  alias: "kca",
  category: "apikey",
  display: {
    name: "Kimi Coding API Key",
    icon: "smart_toy",
    color: "#6C5CE7",
    textIcon: "KCA",
    website: "https://kimi.com",
    notice: {
      apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    },
  },
  transport: {
    baseUrl: "https://api.kimi.com/coding/v1/chat/completions",
    format: "openai",
  },
};
