export default {
  id: "bytez",
  alias: "bytez",
  display: {
    name: "Bytez",
    icon: "bolt",
    color: "#EC4899",
    textIcon: "BZ",
    website: "https://www.bytez.com",
    notice: {
      apiKeyUrl: "https://www.bytez.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.bytez.com/models/v2/openai/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct v0.3" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B Instruct" },
  ],
};
