export default {
  id: "dxnt",
  alias: "dxnt",
  display: {
    name: "DXNT",
    icon: "bolt",
    color: "#0D9488",
    textIcon: "DX",
    website: "https://www.dxnt.com",
    notice: {
      apiKeyUrl: "https://www.dxnt.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://www.dxnt.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://www.dxnt.com/v1/models",
    modelsFetcher: { url: "https://www.dxnt.com/v1/models", type: "openai" },
  },
  models: [],
};
