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
  models: [
    { id: "intern-s1-pro", name: "Intern S1 Pro" },
    { id: "intern-s1", name: "Intern S1" },
    { id: "intern-s1-mini", name: "Intern S1 Mini" },
    { id: "internvl3.5-latest", name: "InternVL 3.5 Latest" },
    { id: "intern-latest", name: "Intern Latest" },
  ],
};
