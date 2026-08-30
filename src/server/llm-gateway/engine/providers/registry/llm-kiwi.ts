export default {
  id: "llm-kiwi",
  alias: "llmkiwi",
  display: {
    name: "LLM Kiwi",
    icon: "bolt",
    color: "#22C55E",
    textIcon: "LK",
    website: "https://llm.kiwi",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.llm.kiwi/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.llm.kiwi/v1/models",
  },
  modelsFetcher: { url: "https://api.llm.kiwi/v1/models", type: "openai" },
};
