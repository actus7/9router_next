export default {
  id: "siliconflow",
  priority: 250,
  alias: "siliconflow",
  display: {
    name: "SiliconFlow",
    icon: "cloud_queue",
    color: "#5B6EF5",
    textIcon: "SF",
    website: "https://cloud.siliconflow.com",
    notice: {
      apiKeyUrl: "https://cloud.siliconflow.com/account/ak",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.siliconflow.com/v1/chat/completions",
    validateUrl: "https://api.siliconflow.com/v1/models",
    thinkingFormat: "openai",
  },

};
