export default {
  id: "duckai",
  priority: 180,
  alias: "duckai",
  aliases: ["da"],
  uiAlias: "da",
  display: {
    name: "Duck.ai",
    icon: "smart_toy",
    color: "#DE5833",
    textIcon: "DA",
    website: "https://duck.ai",
    notice:
      "Anonymous web session protected by anti-bot challenge (VQD). May break when DuckDuckGo rotates challenge scripts.",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://duck.ai/duckchat/v1/chat",
    format: "duckai",
    noAuth: true,
  },
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini (Duck.ai)", capabilities: { vision: true } },
    { id: "gpt-5-mini", name: "GPT-5 Mini (Duck.ai)", capabilities: { vision: true } },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Duck.ai)", capabilities: { vision: true } },
    {
      id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      name: "Llama 4 Scout (Duck.ai)",
    },
    {
      id: "mistralai/Mistral-Small-24B-Instruct-2501",
      name: "Mistral Small 3 (Duck.ai)",
    },
    {
      id: "tinfoil/gpt-oss-120b",
      name: "GPT-OSS 120B (Duck.ai)",
    },
  ],
};
