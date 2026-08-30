export default {
  id: "opper",
  alias: "opper",
  display: {
    name: "Opper",
    icon: "bolt",
    color: "#10B981",
    textIcon: "OP",
    website: "https://opper.ai",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.opper.ai/v3/compat/chat/completions",
    format: "openai",
    validateUrl: "https://api.opper.ai/v3/compat/models",
  },
  modelsFetcher: { url: "https://api.opper.ai/v3/compat/models", type: "openai" },
};
