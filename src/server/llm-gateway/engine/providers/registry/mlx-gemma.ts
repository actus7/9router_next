export default {
  id: "mlx-gemma",
  alias: "mlxg",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "MLX Gemma 26B",
    icon: "auto_awesome",
    color: "#A855F7",
    textIcon: "MXG",
    notice: "MLX Gemma 26B local server",
  },
  transport: {
    baseUrl: "http://localhost:11435/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:11435/v1/models", type: "openai" },
  },
};
