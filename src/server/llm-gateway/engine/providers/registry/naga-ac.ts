export default {
  id: "naga-ac",
  alias: "naga",
  display: {
    name: "Naga",
    icon: "bolt",
    color: "#F43F5E",
    textIcon: "NG",
    website: "https://naga.ac",
  },
  category: "free",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.naga.ac/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.naga.ac/v1/models",
  },
  modelsFetcher: { url: "https://api.naga.ac/v1/models", type: "openai" },
};
