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
  models: [
    { id: "Baichuan4-Turbo", name: "Baichuan4 Turbo", contextLength: 32768 },
    { id: "Baichuan4-Air", name: "Baichuan4 Air", contextLength: 32768 },
    { id: "Baichuan4", name: "Baichuan4" },
    { id: "Baichuan3-Turbo", name: "Baichuan3 Turbo", contextLength: 32768 },
    { id: "Baichuan3-Turbo-128k", name: "Baichuan3 Turbo 128K", contextLength: 131072 },
  ],
};
