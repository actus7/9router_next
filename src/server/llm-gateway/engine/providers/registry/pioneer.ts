export default {
  id: "pioneer",
  alias: "pn",
  display: {
    name: "Pioneer",
    icon: "bolt",
    color: "#6366F1",
    textIcon: "PN",
    website: "https://pioneer.ai",
    notice: {
      apiKeyUrl: "https://pioneer.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.pioneer.ai/v1/chat/completions",
    format: "openai",
    auth: { header: "x-api-key", scheme: "raw", source: ["apiKey"] },
  },
  models: [
    { id: "Qwen/Qwen3-32B", name: "Qwen3 32B" },
    { id: "Qwen/Qwen3.6-27B", name: "Qwen3.6 27B" },
    { id: "Qwen/Qwen3.5-9B", name: "Qwen3.5 9B" },
    { id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" },
    { id: "meta-llama/Llama-3.2-1B-Instruct", name: "Llama 3.2 1B Instruct" },
    { id: "google/gemma-3-4b-pt", name: "Gemma 3 4B PT" },
    { id: "HuggingFaceTB/SmolLM3-3B-Base", name: "SmolLM3 3B Base" },
  ],
};
