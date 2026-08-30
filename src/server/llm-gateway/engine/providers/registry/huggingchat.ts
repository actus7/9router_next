export default {
  id: "huggingchat",
  priority: 150,
  alias: "hc",
  aliases: [
    "hc",
  ],
  uiAlias: "hc",
  display: {
    name: "HuggingChat",
    icon: "auto_awesome",
    color: "#FFD21E",
    textIcon: "HC",
    website: "https://huggingface.co/chat",
    notice: "Free HuggingChat.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your hf-chat cookie from huggingface.co/chat",
  transport: {
    baseUrl: "https://huggingface.co/chat/conversation",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct", name: "Qwen3 235B A22B Instruct" },
  ],
  passthroughModels: true,
};
