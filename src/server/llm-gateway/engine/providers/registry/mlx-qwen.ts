export default {
  id: "mlx-qwen",
  alias: "mlxq",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "MLX Qwen 3.8 27B",
    icon: "psychology",
    color: "#EC4899",
    textIcon: "MXQ",
    notice: "MLX Qwen 3.8 27B local server",
  },
  transport: {
    baseUrl: "http://localhost:11436/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:11436/v1/models", type: "openai" },
  },
};
