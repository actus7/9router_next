export default {
  id: "internlm",
  alias: "internlm",
  display: {
    name: "InternLM",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "IL",
    website: "https://intern-ai.org.cn",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://chat.intern-ai.org.cn/api/v1/chat/completions",
    format: "openai",
  },
};
