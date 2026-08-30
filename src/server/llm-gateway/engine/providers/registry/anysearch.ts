export default {
  id: "anysearch",
  alias: "anysearch",
  display: {
    name: "AnySearch",
    icon: "search",
    color: "#10B981",
    textIcon: "AS",
    website: "https://anysearch.ai",
    notice: {
      text: "Optional API key (as_sk_...)",
    },
  },
  category: "free",
  authType: "apikey",
  noAuth: true,
  transport: {
    baseUrl: "https://api.anysearch.com/v1/search",
    noAuth: true,
  },
  models: [
    { id: "anysearch", name: "AnySearch" },
  ],
  // No models-list endpoint — single search-tool entry, nothing to discover.
  noModelDiscovery: true,
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "anysearch",
    endpoint: "https://api.anysearch.com/v1/search",
  },
};
