export default {
  id: "poe",
  alias: "poe",
  display: {
    name: "Poe",
    icon: "bolt",
    color: "#8B5CF6",
    textIcon: "PO",
    website: "https://poe.com",
    notice: {
      apiKeyUrl: "https://poe.com/api_key",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.poe.com/v1/chat/completions",
    format: "openai",
  },
};
