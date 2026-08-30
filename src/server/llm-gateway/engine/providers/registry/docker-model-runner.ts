export default {
  id: "docker-model-runner",
  alias: "dmr",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "Docker Model Runner",
    icon: "deployed_code",
    color: "#2496ED",
    textIcon: "DMR",
    notice: "Docker Model Runner. Start with: docker model run <model>",
  },
  transport: {
    baseUrl: "http://localhost:12434/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:12434/v1/models", type: "openai" },
  },
};
