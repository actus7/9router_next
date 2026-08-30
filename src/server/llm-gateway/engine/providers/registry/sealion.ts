export default {
  id: "sealion",
  alias: "sl",
  display: {
    name: "SEA-LION",
    icon: "waves",
    color: "#0EA5E9",
    textIcon: "SL",
    website: "https://sea-lion.ai",
    notice: {
      text: "Free key via Google sign-in, no card. 10 RPM. Models from AI Singapore.",
      apiKeyUrl: "https://sea-lion.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.sea-lion.ai/v1/chat/completions",
    validateUrl: "https://api.sea-lion.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.sea-lion.ai/v1/models", type: "openai" },
};
