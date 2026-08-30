export default {
  id: "llama-cpp",
  alias: "llamacpp",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "llama.cpp",
    icon: "pets",
    color: "#F59E0B",
    textIcon: "LLC",
    notice: "llama.cpp server. Start with: llama-server -m <model> --port 8080",
  },
  transport: {
    baseUrl: "http://127.0.0.1:8080/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://127.0.0.1:8080/v1/models", type: "openai" },
  },
};
