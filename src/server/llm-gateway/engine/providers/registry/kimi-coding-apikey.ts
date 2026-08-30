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
  models: [
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code Highspeed" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
};
