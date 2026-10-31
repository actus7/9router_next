export default {
  id: "volcengine-agent-plan",
  alias: "vap",
  category: "apikey",
  display: {
    name: "Volcengine Agent Plan",
    icon: "cloud",
    color: "#1677FF",
    textIcon: "VAP",
    website: "https://console.volcengine.com/ark",
    notice: {
      apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    },
  },
  transport: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
    format: "openai",
  },
};
