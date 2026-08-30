export default {
  id: "quillbot",
  alias: "quillbot",
  display: {
    name: "Quillbot AI",
    icon: "auto_fix_high",
    color: "#E67E22",
    textIcon: "QB",
    website: "https://quillbot.com",
    notice: "Anonymous web session — no history sent upstream, no tool calling. May break if Quillbot changes its frontend.",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://quillbot.com/api/ai-chat/chat/conversation",
    format: "openai",
    executor: "quillbot",
    noAuth: true,
  },
  models: [
    { id: "quillbot-ai", name: "Quillbot AI Chat" },
  ],
  // No models-list endpoint — single-model scraped web session, nothing to discover.
  noModelDiscovery: true,
};
