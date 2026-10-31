export default {
  id: "deepinfra",
  alias: "deepinfra",
  display: {
    name: "DeepInfra",
    icon: "cloud",
    color: "#7C3AED",
    textIcon: "DI",
    website: "https://deepinfra.com",
    notice: {
      apiKeyUrl: "https://deepinfra.com/dash/api_keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
    format: "openai",
    validateUrl: "https://api.deepinfra.com/v1/openai/models",
  },
};
