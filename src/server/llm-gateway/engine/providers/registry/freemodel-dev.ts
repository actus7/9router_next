export default {
  id: "freemodel-dev",
  alias: "fmd",
  display: {
    name: "FreeModel.dev",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "FM",
    website: "https://freemodel.dev",
    notice: {
      apiKeyUrl: "https://freemodel.dev",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.freemodel.dev/v1/models",
    modelsFetcher: { url: "https://api.freemodel.dev/v1/models", type: "openai" },
  },
  models: [
    { id: "gpt-5.5", name: "GPT 5.5", contextLength: 400000 },
    { id: "gpt-5.4", name: "GPT 5.4", contextLength: 400000 },
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
  ],
};
