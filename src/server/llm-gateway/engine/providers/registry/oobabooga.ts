export default {
  id: "oobabooga",
  alias: "ooba",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "Text Generation WebUI",
    icon: "terminal",
    color: "#8B5CF6",
    textIcon: "OOB",
    notice: "Text Generation WebUI (oobabooga). Start with: python server.py --api",
  },
  transport: {
    baseUrl: "http://localhost:5000/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://localhost:5000/v1/models", type: "openai" },
  },
};
