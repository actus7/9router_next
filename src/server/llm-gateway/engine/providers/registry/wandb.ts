export default {
  id: "wandb",
  alias: "wandb",
  display: {
    name: "Weights & Biases",
    icon: "bolt",
    color: "#FFBE00",
    textIcon: "WB",
    website: "https://wandb.ai",
    notice: {
      apiKeyUrl: "https://wandb.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.inference.wandb.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B" },
    { id: "deepseek-ai/DeepSeek-V3.1", name: "DeepSeek V3.1" },
  ],
};
