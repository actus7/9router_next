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
    baseUrl: "https://api.context7.com/v1/search",
  },
  models: [
    { id: "context7", name: "Context7" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "context7",
    endpoint: "https://api.context7.com/v1/search",
  },
};
