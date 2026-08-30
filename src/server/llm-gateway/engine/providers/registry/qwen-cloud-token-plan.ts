export default {
  id: "qwen-cloud-token-plan",
  alias: "qct",
  display: {
    name: "Qwen Cloud Token Plan",
    icon: "bolt",
    color: "#FF6A00",
    textIcon: "QT",
    website: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    notice: {
      apiKeyUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "qwen3.8-max", name: "Qwen3.8 Max", contextLength: 1000000 },
    { id: "qwen3.7-max", name: "Qwen3.7 Max", contextLength: 1000000 },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", contextLength: 1000000 },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash", contextLength: 1000000 },
    { id: "glm-5.2", name: "GLM 5.2", contextLength: 1000000 },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1000000 },
    { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731", contextLength: 1000000 },
  ],
};
