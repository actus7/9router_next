export default {
  id: "nararouter",
  alias: "nr",
  aliases: ["nara", "bynara"],
  uiAlias: "nr",
  display: {
    name: "NaraRouter",
    icon: "router",
    color: "#6366F1",
    textIcon: "NR",
    website: "https://router.bynara.id",
    notice: {
      text: "Requires Telegram verification to get an API key.",
      apiKeyUrl: "https://router.bynara.id",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://router.bynara.id/v1/chat/completions",
    validateUrl: "https://router.bynara.id/v1/models",
  },
  passthroughModels: true,
};
