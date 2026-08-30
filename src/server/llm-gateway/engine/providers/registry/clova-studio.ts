export default {
  id: "clova-studio",
  alias: "clova",
  display: {
    name: "CLOVA Studio",
    icon: "smart_toy",
    color: "#06B6D4",
    textIcon: "CL",
    website: "https://clovastudio.ncloud.com",
    notice: {
      apiKeyUrl: "https://clovastudio.ncloud.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://clovastudio.stream.ntruss.com/v1/openai/chat/completions",
    format: "openai",
    validateUrl: "https://clovastudio.stream.ntruss.com/v1/openai/models",
  },
  models: [
    { id: "HCX-007", name: "HCX 007" },
    { id: "HCX-005", name: "HCX 005" },
  ],
};
