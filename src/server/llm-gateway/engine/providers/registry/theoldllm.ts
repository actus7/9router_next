export default {
  id: "theoldllm",
  priority: 150,
  alias: "toll",
  aliases: [
    "toll",
  ],
  uiAlias: "toll",
  display: {
    name: "The Old LLM",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "TOLL",
    website: "https://theoldllm.com",
    notice: "The Old LLM. Auto-generates tokens via Playwright headless. Fragile — may break if site changes.",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://theoldllm.com/api/chat/completions",
    format: "openai",
  },
  models: [
    { id: "theoldllm-default", name: "TheOldLLM Default" },
  ],
  passthroughModels: true,
};
