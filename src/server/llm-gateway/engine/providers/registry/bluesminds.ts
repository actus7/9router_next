export default {
  id: "bluesminds",
  alias: "bm",
  aliases: ["blue-sminds"],
  uiAlias: "bm",
  hidden: true,
  display: {
    name: "BluesMinds",
    icon: "psychology",
    color: "#2563EB",
    textIcon: "BM",
    website: "https://bluesminds.com",
    notice: { apiKeyUrl: "https://bluesminds.com" },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.bluesminds.com/v1/chat/completions",
    validateUrl: "https://api.bluesminds.com/v1/models",
  },
};
