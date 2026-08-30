export default {
  id: "baseten",
  alias: "baseten",
  display: {
    name: "Baseten",
    icon: "cloud",
    color: "#8B5CF6",
    textIcon: "BT",
    website: "https://www.baseten.co",
    notice: {
      apiKeyUrl: "https://www.baseten.co/developer/",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.baseten.co/v1/chat/completions",
    format: "openai",
    validateUrl: "https://inference.baseten.co/v1/models",
  },
  models: [
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "zai-org/GLM-5", name: "GLM 5" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "nvidia/Nemotron-120B-A12B", name: "Nemotron 120B A12B" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  ],
};
