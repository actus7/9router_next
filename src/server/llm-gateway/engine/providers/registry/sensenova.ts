export default {
  id: "sensenova",
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "SN",
    website: "https://sensenova.cn",
    notice: {
      apiKeyUrl: "https://sensenova.cn",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash Lite", contextLength: 262144 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1048576 },
    { id: "glm-5.2", name: "GLM 5.2", contextLength: 1048576 },
  ],
};
