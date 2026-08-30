export default {
  id: "nube",
  alias: "nube",
  display: {
    name: "Nube",
    icon: "bolt",
    color: "#6366F1",
    textIcon: "NB",
    website: "https://nube.sh",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://ai.nube.sh/api/v1/chat/completions",
    format: "openai",
    validateUrl: "https://ai.nube.sh/api/v1/models",
    modelsFetcher: { url: "https://ai.nube.sh/api/v1/models", type: "openai" },
  },
  models: [],
};
