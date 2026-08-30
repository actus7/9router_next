export default {
  id: "helyxai",
  alias: "helyxai",
  display: {
    name: "HelyxAI",
    icon: "bolt",
    color: "#8B5CF6",
    textIcon: "HX",
    website: "https://helyxai.space",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://helyxai.space/v1/chat/completions",
    format: "openai",
    validateUrl: "https://helyxai.space/v1/models",
  },
  modelsFetcher: { url: "https://helyxai.space/v1/models", type: "openai" },
};
