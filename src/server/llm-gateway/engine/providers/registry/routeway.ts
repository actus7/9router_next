export default {
  id: "routeway",
  alias: "rw",
  display: {
    name: "Routeway",
    icon: "alt_route",
    color: "#6366F1",
    textIcon: "RW",
    website: "https://routeway.ai",
    notice: {
      text: "Free models (:free suffix), ~5 RPM observed. Free key from routeway.ai, no card.",
      apiKeyUrl: "https://routeway.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.routeway.ai/v1/chat/completions",
    validateUrl: "https://api.routeway.ai/v1/models",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  },
  modelsFetcher: { url: "https://api.routeway.ai/v1/models", type: "openai" },
};
