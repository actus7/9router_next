export default {
  id: "bazaarlink",
  alias: "bzl",
  aliases: ["bazaar-link"],
  uiAlias: "bzl",
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "Bazaarlink",
    icon: "storefront",
    color: "#DC2626",
    textIcon: "BZ",
    website: "https://bazaarlink.ai",
    notice: { apiKeyUrl: "https://bazaarlink.ai" },
  },
  transport: {
    baseUrl: "https://bazaarlink.ai/api/v1/chat/completions",
    validateUrl: "https://bazaarlink.ai/api/v1/models",
  },
};
