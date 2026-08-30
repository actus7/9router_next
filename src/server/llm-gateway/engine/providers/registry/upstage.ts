export default {
  id: "upstage",
  alias: "upstage",
  display: {
    name: "Upstage",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "US",
    website: "https://upstage.ai",
    notice: {
      apiKeyUrl: "https://upstage.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.upstage.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "solar-pro3", name: "Solar Pro3" },
    { id: "solar-mini", name: "Solar Mini" },
  ],
};
