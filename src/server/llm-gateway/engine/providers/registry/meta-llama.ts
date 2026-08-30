export default {
  id: "meta-llama",
  alias: "meta",
  display: {
    name: "Meta Llama",
    icon: "bolt",
    color: "#0081FB",
    textIcon: "ML",
    website: "https://llama.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.llama.com/compat/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama 4 Maverick 17B 128E Instruct FP8" },
    { id: "Llama-4-Scout-17B-16E-Instruct-FP8", name: "Llama 4 Scout 17B 16E Instruct FP8" },
    { id: "Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "Llama-3.3-8B-Instruct", name: "Llama 3.3 8B Instruct" },
  ],
};
