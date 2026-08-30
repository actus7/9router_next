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
  },
  modelsFetcher: { url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", type: "openai" },
};
