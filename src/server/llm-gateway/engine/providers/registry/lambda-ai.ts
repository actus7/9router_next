export default {
  id: "lambda-ai",
  alias: "lambda",
  display: {
    name: "Lambda AI",
    icon: "bolt",
    color: "#6366F1",
    textIcon: "LA",
    website: "https://lambda.ai",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.lambda.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "deepseek-r1-671b", name: "DeepSeek R1 671B" },
    { id: "llama3.3-70b-instruct-fp8", name: "Llama 3.3 70B Instruct FP8" },
    { id: "qwen25-coder-32b-instruct", name: "Qwen 2.5 Coder 32B Instruct" },
  ],
};
