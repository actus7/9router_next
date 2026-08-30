export default {
  id: "plamo",
  alias: "plamo",
  display: {
    name: "PLaMo",
    icon: "bolt",
    color: "#0EA5E9",
    textIcon: "PM",
    website: "https://preferredai.jp",
    notice: {
      apiKeyUrl: "https://platform.preferredai.jp",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.platform.preferredai.jp/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "plamo-3.0-prime", name: "PLaMo 3.0 Prime", contextLength: 262144 },
  ],
};
