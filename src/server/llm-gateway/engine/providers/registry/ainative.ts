export default {
  id: "ainative",
  alias: "ain",
  display: {
    name: "AINative Studio",
    icon: "auto_awesome",
    color: "#F59E0B",
    textIcon: "AI",
    website: "https://ainative.studio",
    notice: {
      text: "~10M tokens/month free (unverified). Bearer auth; X-API-Key also accepted.",
      apiKeyUrl: "https://ainative.studio",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ainative.studio/api/v1/chat/completions",
    validateUrl: "https://api.ainative.studio/api/v1/models",
  },
  modelsFetcher: { url: "https://api.ainative.studio/api/v1/models", type: "openai" },
};
