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
};
