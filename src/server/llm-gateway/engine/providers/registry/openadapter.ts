export default {
  id: "openadapter",
  alias: "oad",
  display: {
    name: "OpenAdapter",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "OA",
    website: "https://openadapter.in",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.openadapter.in/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.openadapter.in/v1/models",
  },
  modelsFetcher: { url: "https://api.openadapter.in/v1/models", type: "openai" },
};
