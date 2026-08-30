export default {
  id: "mixlayer",
  alias: "mixlayer",
  display: {
    name: "MixLayer",
    icon: "bolt",
    color: "#D946EF",
    textIcon: "MX",
    website: "https://mixlayer.ai",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://models.mixlayer.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://models.mixlayer.ai/v1/models",
    modelsFetcher: { url: "https://models.mixlayer.ai/v1/models", type: "openai" },
  },
  models: [
    { id: "qwen/qwen3.5-4b-free", name: "Qwen 3.5 4B Free" },
  ],
};
