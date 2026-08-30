export default {
  id: "x-search",
  alias: "xsearch",
  display: {
    name: "xAI Search",
    icon: "search",
    color: "#1DA1F2",
    textIcon: "XS",
    website: "https://x.ai",
    notice: {
      text: "Uses same xAI API key. Requires Grok subscription or API key",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
  },
  models: [
    { id: "grok-3", name: "Grok 3" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "grok-3",
    endpoint: "https://api.x.ai/v1/chat/completions",
  },
};
