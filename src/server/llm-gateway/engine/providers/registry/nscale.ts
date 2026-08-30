export default {
  id: "nscale",
  alias: "nscale",
  display: {
    name: "Nscale",
    icon: "bolt",
    color: "#0D9488",
    textIcon: "NS",
    website: "https://nscale.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.api.nscale.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen3 235B A22B Instruct" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
    { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", name: "Llama 4 Scout 17B 16E Instruct" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
  ],
};
