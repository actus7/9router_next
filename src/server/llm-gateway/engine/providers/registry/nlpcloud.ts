export default {
  id: "nlpcloud",
  alias: "nlpcloud",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://nlpcloud.io",
  display: {
    name: "NLP Cloud",
    icon: "psychology",
    color: "#10B981",
    textIcon: "NC",
    website: "https://nlpcloud.io",
    notice: {
      apiKeyUrl: "https://nlpcloud.io",
    },
  },
  transport: {
    baseUrl: "https://api.nlpcloud.io/v1/chat/completions",
    auth: { header: "Authorization", scheme: "Token", source: ["apiKey"] },
  },
  models: [
    { id: "python3.1-3b", name: "Python 3.1 3B" },
  ],
};
