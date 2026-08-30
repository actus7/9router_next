export default {
  id: "qwen-cloud",
  alias: "qwc",
  display: {
    name: "Qwen Cloud",
    icon: "bolt",
    color: "#FF6A00",
    textIcon: "QW",
    website: "https://dashscope-intl.aliyuncs.com",
    notice: {
      apiKeyUrl: "https://dashscope-intl.aliyuncs.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
    validateUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    modelsFetcher: { url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", type: "openai" },
  },
  models: [
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  ],
};
