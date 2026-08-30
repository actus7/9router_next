export default {
  id: "synthetic",
  alias: "synthetic",
  display: {
    name: "Synthetic",
    icon: "bolt",
    color: "#A855F7",
    textIcon: "SY",
    website: "https://synthetic.new",
    notice: {
      apiKeyUrl: "https://synthetic.new",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.synthetic.new/openai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.synthetic.new/openai/v1/models",
  },
  modelsFetcher: { url: "https://api.synthetic.new/openai/v1/models", type: "openai" },
};
