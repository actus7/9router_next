export default {
  id: "triton",
  alias: "triton",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "NVIDIA Triton",
    icon: "memory",
    color: "#76B900",
    textIcon: "TRI",
    notice: "NVIDIA Triton Inference Server",
  },
  transport: {
    baseUrl: "http://localhost:8000/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:8000/v1/models", type: "openai" },
  },
};
