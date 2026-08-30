export default {
  id: "typhoon",
  alias: "typhoon",
  display: {
    name: "Typhoon",
    icon: "bolt",
    color: "#0EA5E9",
    textIcon: "TP",
    website: "https://opentyphoon.ai",
    notice: {
      apiKeyUrl: "https://opentyphoon.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.opentyphoon.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "typhoon-v2.5-30b-a3b-instruct", name: "Typhoon v2.5 30B A3B Instruct", contextLength: 131072 },
  ],
};
