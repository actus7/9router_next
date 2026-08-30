export default {
  id: "scaleway",
  alias: "scaleway",
  display: {
    name: "Scaleway AI",
    icon: "cloud",
    color: "#4F0599",
    textIcon: "SC",
    website: "https://www.scaleway.com/en/ai/",
    notice: {
      text: "Scaleway AI. Configure project and region.",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.scaleway.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "llama-3-3-70b-instruct", name: "Llama 3.3 70B Instruct" },
    { id: "mistral-nemo-instruct-2407", name: "Mistral Nemo Instruct" },
  ],
};
