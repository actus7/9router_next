export default {
  id: "novita",
  alias: "novita",
  display: {
    name: "Novita AI",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "NV",
    website: "https://novita.ai",
    notice: {
      apiKeyUrl: "https://novita.ai/settings/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.novita.ai/openai/v1/models",
    modelsFetcher: { url: "https://api.novita.ai/openai/v1/models", type: "openai" },
  },
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1048576 },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1048576 },
    { id: "moonshotai/kimi-k3", name: "Kimi K3", contextLength: 1048576 },
    { id: "zai-org/glm-5.2", name: "GLM 5.2", contextLength: 1048576 },
    { id: "minimax/minimax-m3", name: "MiniMax M3", contextLength: 1000000 },
    { id: "qwen/qwen3.7-max", name: "Qwen 3.7 Max", contextLength: 1000000 },
    { id: "xiaomimimo/mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextLength: 1048576 },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", contextLength: 131072 },
    { id: "google/gemma-4-31b-it", name: "Gemma 4 31B IT", contextLength: 262144 },
    { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", contextLength: 16384 },
  ],
};
