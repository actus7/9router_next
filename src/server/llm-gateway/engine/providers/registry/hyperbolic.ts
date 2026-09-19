export default {
  id: "hyperbolic",
  priority: 160,
  alias: "hyperbolic",
  aliases: [
    "hyp",
  ],
  uiAlias: "hyp",
  display: {
    name: "Hyperbolic",
    icon: "bolt",
    color: "#00D4FF",
    textIcon: "HY",
    website: "https://hyperbolic.xyz",
    notice: {
      apiKeyUrl: "https://app.hyperbolic.xyz/settings",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.hyperbolic.xyz/v1/chat/completions",
    validateUrl: "https://api.hyperbolic.xyz/v1/models",
  },

};
