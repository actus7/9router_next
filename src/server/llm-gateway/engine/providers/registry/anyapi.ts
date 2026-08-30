export default {
  id: "anyapi",
  alias: "any",
  display: {
    name: "AnyAPI",
    icon: "api",
    color: "#10B981",
    textIcon: "AN",
    website: "https://anyapi.ai",
    notice: {
      text: "100K tokens/day free, no card required. Only 'free' and 'basic' models in scope.",
      apiKeyUrl: "https://anyapi.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.anyapi.ai/v1/chat/completions",
    validateUrl: "https://api.anyapi.ai/v1/models",
  },
  models: [
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)" },
    { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (free)" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B (free)" },
    { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B (free)" },
  ],
  modelsFetcher: { url: "https://api.anyapi.ai/v1/models", type: "openai" },
};
