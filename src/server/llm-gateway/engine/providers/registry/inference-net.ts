export default {
  id: "inference-net",
  alias: "inet",
  display: {
    name: "Inference.net",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "IN",
    website: "https://inference.net",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.inference.net/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B Instruct" },
  ],
};
