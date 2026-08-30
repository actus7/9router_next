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
  models: [
    { id: "aisingapore/sea-lion-v3-7b-instruct", name: "SEA-LION v3 7B" },
    { id: "aisingapore/sea-lion-v3-9b-it", name: "SEA-LION v3 9B IT" },
    { id: "aisingapore/sea-lion-e5-embedding-600m", name: "SEA-LION E5 Embedding 600M" },
  ],
  modelsFetcher: { url: "https://api.sea-lion.ai/v1/models", type: "openai" },
};
