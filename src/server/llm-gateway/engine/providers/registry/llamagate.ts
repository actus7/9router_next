export default {
  id: "llamagate",
  alias: "llamagate",
  display: {
    name: "LlamaGate",
    icon: "bolt",
    color: "#84CC16",
    textIcon: "LG",
    website: "https://llamagate.ai",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://llamagate.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "qwen2.5-coder-7b", name: "Qwen 2.5 Coder 7B" },
    { id: "deepseek-coder-6.7b", name: "DeepSeek Coder 6.7B" },
    { id: "qwen3-vl-8b", name: "Qwen 3 VL 8B" },
  ],
};
