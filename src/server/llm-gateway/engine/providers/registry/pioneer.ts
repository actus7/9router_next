export default {
  id: "pioneer",
  alias: "pn",
  display: {
    name: "Pioneer",
    icon: "bolt",
    color: "#6366F1",
    textIcon: "PN",
    website: "https://pioneer.ai",
    notice: {
      apiKeyUrl: "https://pioneer.ai",
    },
  },
  category: "apikey",
  transport: {
    // api.pioneer.ai answers 410 "This API host was retired. Use https://api.fastino.ai".
    baseUrl: "https://api.fastino.ai/v1/chat/completions",
    format: "openai",
    auth: { header: "x-api-key", scheme: "raw", source: ["apiKey"] },
  },
};
