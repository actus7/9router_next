export default {
  id: "360ai",
  alias: "360ai",
  category: "apikey",
  display: {
    name: "360AI",
    icon: "smart_toy",
    color: "#00B140",
    textIcon: "360",
    website: "https://ai.360.cn",
    notice: {
      apiKeyUrl: "https://ai.360.cn/platform/keys",
    },
  },
  transport: {
    baseUrl: "https://api.360.cn/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "360-gpt2-pro", name: "360 GPT2 Pro" },
    { id: "360-gpt2-turbo", name: "360 GPT2 Turbo" },
  ],
};
