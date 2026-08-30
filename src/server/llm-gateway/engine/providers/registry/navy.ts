export default {
  id: "navy",
  alias: "ny",
  display: {
    name: "NavyAI",
    icon: "sailing",
    color: "#1E3A5F",
    textIcon: "NY",
    website: "https://navy.ai",
    notice: {
      text: "150K tokens/day, 20 RPM. Free key from navy.ai, no card.",
      apiKeyUrl: "https://navy.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.navy/v1/chat/completions",
    validateUrl: "https://api.navy/v1/models",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  },
  modelsFetcher: { url: "https://api.navy/v1/models", type: "openai" },
};
