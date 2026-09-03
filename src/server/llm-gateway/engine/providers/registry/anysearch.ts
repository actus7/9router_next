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
  // AnySearch is a dedicated search API, not a chat endpoint, so /v1/search
  // reaches it through the same builder/normalizer path as Brave or Tavily.
  // The key is optional: authType "none" keeps it usable with no connection,
  // and a configured key still rides along as a bearer token.
  searchConfig: {
    baseUrl: "https://api.anysearch.com/v1/search",
    method: "POST",
    authType: "none",
    authHeader: "bearer",
    costPerQuery: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    timeoutMs: 10000,
  },
};
