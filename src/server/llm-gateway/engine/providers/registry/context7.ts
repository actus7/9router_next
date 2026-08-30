export default {
  id: "context7",
  alias: "ctx7",
  display: {
    name: "Context7",
    icon: "search",
    color: "#3B82F6",
    textIcon: "C7",
    website: "https://context7.com",
    notice: {
      text: "Optional API key (ctx7sk-...)",
    },
  },
  category: "free",
  authType: "apikey",
  noAuth: true,
  transport: {
    baseUrl: "https://context7.com/api/v1",
  },
  models: [
    { id: "context7", name: "Context7" },
  ],
  // No models-list endpoint — single search-tool entry, nothing to discover.
  noModelDiscovery: true,
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "context7",
    endpoint: "https://context7.com/api/v1",
  },
};
