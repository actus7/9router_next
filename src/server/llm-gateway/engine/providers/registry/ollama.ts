export default {
  id: "ollama",
  priority: 30,
  hasFree: true,
  alias: "ollama",
  display: {
    name: "Ollama Cloud",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
    notice: {
      text: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.",
      apiKeyUrl: "https://ollama.com/settings/keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://ollama.com/api/chat",
    validateUrl: "https://ollama.com/api/tags",
    format: "ollama",
  },

  serviceKinds: ["llm"],
  features: {
    usage: true,
    usageApikey: true,
  },
};
