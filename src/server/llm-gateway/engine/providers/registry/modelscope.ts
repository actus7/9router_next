export default {
  id: "modelscope",
  alias: "mdl",
  aliases: ["model-scope"],
  uiAlias: "mdl",
  display: {
    name: "ModelScope",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: {
      text: "Requires Alibaba Cloud CN account with real-name verification. Free daily quota (魔粒).",
      apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/models",
    timeoutMs: 90000,
  },
  models: [
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen3 235B Instruct" },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B" },
    { id: "Qwen/Qwen3-32B", name: "Qwen3 32B" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen2.5 72B Instruct" },
  ],
};
