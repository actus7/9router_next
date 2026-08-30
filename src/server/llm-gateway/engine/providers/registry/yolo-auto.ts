export default {
  id: "yolo-auto",
  alias: "yolo",
  display: {
    name: "YOLO Auto",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "YO",
    website: "https://yolo-auto.com",
    notice: {
      apiKeyUrl: "https://yolo-auto.com",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://yolo-auto.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://yolo-auto.com/v1/models",
  },
  modelsFetcher: { url: "https://yolo-auto.com/v1/models", type: "openai" },
};
