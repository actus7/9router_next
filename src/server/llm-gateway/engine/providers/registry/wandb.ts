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
};
