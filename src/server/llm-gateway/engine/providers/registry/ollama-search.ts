export default {
  id: "ollama-search",
  alias: "osearch",
  display: {
    name: "Ollama Search",
    icon: "search",
    color: "#F5F5F5",
    textIcon: "OS",
    website: "https://ollama.com",
    notice: {
      text: "Uses same Ollama Cloud API key",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://ollama.com/api/search",
  },
  models: [
    { id: "ollama-search", name: "Ollama Search" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "ollama-search",
    endpoint: "https://ollama.com/api/search",
  },
};
