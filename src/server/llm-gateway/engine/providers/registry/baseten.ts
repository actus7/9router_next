export default {
  id: "baseten",
  alias: "baseten",
  display: {
    name: "Baseten",
    icon: "cloud",
    color: "#8B5CF6",
    textIcon: "BT",
    website: "https://www.baseten.co",
    notice: {
      apiKeyUrl: "https://www.baseten.co/developer/",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.baseten.co/v1/chat/completions",
    format: "openai",
    validateUrl: "https://inference.baseten.co/v1/models",
  },
};
