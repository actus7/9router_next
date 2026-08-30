export default {
  id: "freetheai",
  alias: "fta",
  display: {
    name: "FreeTheAI",
    icon: "bolt",
    color: "#16A34A",
    textIcon: "FT",
    website: "https://freetheai.xyz",
    notice: {
      apiKeyUrl: "https://freetheai.xyz",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.freetheai.xyz/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.freetheai.xyz/v1/models",
    modelsFetcher: { url: "https://api.freetheai.xyz/v1/models", type: "openai" },
  },
  models: [
    { id: "gpt-4o-mini", name: "GPT 4o Mini" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct" },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
  ],
};
