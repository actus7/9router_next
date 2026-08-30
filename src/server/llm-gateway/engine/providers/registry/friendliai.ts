export default {
  id: "friendliai",
  alias: "friendli",
  display: {
    name: "FriendliAI",
    icon: "bolt",
    color: "#6D28D9",
    textIcon: "FL",
    website: "https://friendli.ai",
    notice: {
      apiKeyUrl: "https://friendli.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.friendli.ai/serverless/v1/models",
  },
  modelsFetcher: { url: "https://api.friendli.ai/serverless/v1/models", type: "openai" },
};
