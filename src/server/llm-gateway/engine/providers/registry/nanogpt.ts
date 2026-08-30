export default {
  id: "nanogpt",
  alias: "nanogpt",
  display: {
    name: "NanoGPT",
    icon: "bolt",
    color: "#7C3AED",
    textIcon: "NG",
    website: "https://nano-gpt.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://nano-gpt.com/api/v1/chat/completions",
    format: "openai",
    validateUrl: "https://nano-gpt.com/api/v1/models",
  },
  modelsFetcher: { url: "https://nano-gpt.com/api/v1/models", type: "openai" },
};
