export default {
  id: "publicai",
  alias: "publicai",
  display: {
    name: "PublicAI",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "PA",
    website: "https://publicai.co",
    notice: {
      apiKeyUrl: "https://publicai.co",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.publicai.co/v1/chat/completions",
    format: "openai",
  },
};
