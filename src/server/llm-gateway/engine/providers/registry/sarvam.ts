export default {
  id: "sarvam",
  alias: "sarvam",
  display: {
    name: "Sarvam",
    icon: "bolt",
    color: "#EC4899",
    textIcon: "SV",
    website: "https://sarvam.ai",
    notice: {
      apiKeyUrl: "https://sarvam.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.sarvam.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "sarvam-105b", name: "Sarvam 105B", contextLength: 131072 },
    { id: "sarvam-30b", name: "Sarvam 30B", contextLength: 65536 },
  ],
};
