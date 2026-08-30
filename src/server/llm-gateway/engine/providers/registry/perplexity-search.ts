export default {
  id: "perplexity-search",
  alias: "psearch",
  display: {
    name: "Perplexity Search",
    icon: "search",
    color: "#20808D",
    textIcon: "PS",
    website: "https://www.perplexity.ai",
    notice: {
      text: "Uses same API key as Perplexity LLM provider",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.perplexity.ai/chat/completions",
  },
  models: [
    { id: "sonar", name: "Sonar" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "sonar",
    endpoint: "https://api.perplexity.ai/chat/completions",
  },
};
