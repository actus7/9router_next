export default {
  id: "synthetic",
  alias: "synthetic",
  display: {
    name: "Synthetic",
    icon: "bolt",
    color: "#A855F7",
    textIcon: "SY",
    website: "https://synthetic.new",
    notice: {
      apiKeyUrl: "https://synthetic.new",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.synthetic.new/openai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.synthetic.new/openai/v1/models",
    modelsFetcher: { url: "https://api.synthetic.new/openai/v1/models", type: "openai" },
  },
  models: [
    { id: "hf:openai/gpt-oss-120b", name: "GPT-OSS 120B", contextLength: 131072 },
    { id: "hf:zai-org/GLM-5.2", name: "GLM 5.2", contextLength: 524288 },
    { id: "hf:moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code", contextLength: 262144 },
    { id: "hf:Qwen/Qwen3.6-27B", name: "Qwen3.6 27B", contextLength: 262144 },
    { id: "hf:MiniMaxAI/MiniMax-M3", name: "MiniMax M3", contextLength: 262144 },
  ],
};
