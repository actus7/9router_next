export default {
  id: "llamafile",
  alias: "llamafile",
  category: "free",
  noAuth: true,
  passthroughModels: true,
  display: {
    name: "Llamafile",
    icon: "folder_open",
    color: "#EF4444",
    textIcon: "LLF",
    notice: "Llamafile local server. Run the llamafile binary to start",
  },
  transport: {
    baseUrl: "http://127.0.0.1:8080/v1/chat/completions",
    format: "openai",
    timeoutMs: 120000,
    modelsFetcher: { url: "http://127.0.0.1:8080/v1/models", type: "openai" },
  },
};
