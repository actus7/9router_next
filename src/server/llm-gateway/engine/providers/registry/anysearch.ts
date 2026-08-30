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
    baseUrl: "https://api.anysearch.ai/v1/chat/completions",
  },
  models: [
    { id: "anysearch", name: "AnySearch" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "anysearch",
    endpoint: "https://api.anysearch.ai/v1/chat/completions",
  },
};
