export default {
  id: "bailian-coding-plan",
  alias: "bcp",
  category: "apikey",
  display: {
    name: "Bailian Coding Plan",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "BCP",
    website: "https://bailian.console.aliyun.com",
    notice: {
      apiKeyUrl: "https://bailian.console.aliyun.com",
    },
  },
  transport: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages",
    format: "claude",
    auth: { header: "x-api-key", scheme: "raw" },
  },
  models: [
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview", contextWindow: 1000000 },
    { id: "qwen3.7-max", name: "Qwen3.7 Max", contextWindow: 1000000 },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", contextWindow: 1000000 },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash", contextWindow: 1000000 },
    { id: "glm-5.2", name: "GLM-5.2", contextWindow: 1000000 },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 163840 },
  ],
};
