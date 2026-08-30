export default {
  id: "volcengine-coding-plan",
  alias: "vcp",
  category: "apikey",
  display: {
    name: "Volcengine Coding Plan",
    icon: "cloud",
    color: "#1677FF",
    textIcon: "VCP",
    website: "https://console.volcengine.com/ark",
    notice: {
      apiKeyUrl: "https://console.volcengine.com/ark/region:ark+ap-southeast/apiKey",
    },
  },
  transport: {
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions",
    format: "openai",
  },
  models: [
    { id: "doubao-seed-2-0-pro-260215", name: "Doubao Seed 2.0 Pro", contextWindow: 262144 },
    { id: "doubao-seed-2-0-lite-260215", name: "Doubao Seed 2.0 Lite", contextWindow: 262144 },
  ],
};
