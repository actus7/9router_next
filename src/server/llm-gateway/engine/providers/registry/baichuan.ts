export default {
  id: "baichuan",
  alias: "baichuan",
  display: {
    name: "Baichuan",
    icon: "smart_toy",
    color: "#3B82F6",
    textIcon: "BC",
    website: "https://www.baichuan-ai.com",
    notice: {
      apiKeyUrl: "https://platform.baichuan-ai.com/console/apikey",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.baichuan-ai.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.baichuan-ai.com/v1/models",
  },
};
