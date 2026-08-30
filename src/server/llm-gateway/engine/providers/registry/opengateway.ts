export default {
  id: "opengateway",
  alias: "og",
  display: {
    name: "OpenGateway",
    icon: "lan",
    color: "#8B5CF6",
    textIcon: "OG",
    website: "https://opengateway.gitlawb.com",
    notice: {
      apiKeyUrl: "https://opengateway.gitlawb.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opengateway.gitlawb.com/v1/chat/completions",
    validateUrl: "https://opengateway.gitlawb.com/v1/models",
    headers: {
      "accept-encoding": "identity",
    },
  },
  models: [
    { id: "mimo-v2.5-pro", name: "Mimo v2.5 Pro", tools: true },
  ],
};
