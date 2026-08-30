export default {
  id: "vllm",
  alias: "vllm",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "vLLM",
    icon: "speed",
    color: "#10B981",
    textIcon: "VLM",
    notice: "vLLM local server. Start with: vllm serve <model>",
  },
  transport: {
    baseUrl: "http://localhost:8000/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:8000/v1/models", type: "openai" },
  },
};
