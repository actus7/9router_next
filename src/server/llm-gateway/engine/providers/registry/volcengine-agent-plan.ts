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
  models: [
    { id: "doubao-seed-2-0-pro-260215", name: "Doubao Seed 2.0 Pro", contextWindow: 262144 },
    { id: "doubao-seed-2-0-lite-260215", name: "Doubao Seed 2.0 Lite", contextWindow: 262144 },
    { id: "doubao-seed-1-8-251228", name: "Doubao Seed 1.8", contextWindow: 262144 },
  ],
};
