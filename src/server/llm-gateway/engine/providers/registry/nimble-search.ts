export default {
  id: "nimble-search",
  alias: "nimble",
  display: {
    name: "Nimble Search",
    icon: "search",
    color: "#8B5CF6",
    textIcon: "NM",
    website: "https://nimbleway.com",
    notice: {
      apiKeyUrl: "https://nimbleway.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.nimbleway.com/v1/search",
  },
  models: [
    { id: "nimble", name: "Nimble" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "nimble",
    endpoint: "https://api.nimbleway.com/v1/search",
  },
};
