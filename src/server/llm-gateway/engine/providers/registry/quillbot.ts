export default {
  id: "quillbot",
  alias: "quillbot",
  display: {
    name: "Quillbot AI",
    icon: "auto_fix_high",
    color: "#E67E22",
    textIcon: "QB",
    website: "https://quillbot.com",
    notice: "Anonymous web API — no history sent upstream, no tool calling. Uses api.quillbot.com; the www host is behind a Cloudflare challenge. May break if Quillbot changes its API.",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.quillbot.com/api/ai-chat/chat/conversation",
    format: "openai",
    executor: "quillbot",
    noAuth: true,
  },
  models: [
    { id: "quillbot-ai", name: "Quillbot AI Chat" },
  ],
  // No models-list endpoint — single-model scraped web session, nothing to discover.
  noModelDiscovery: true,
  // The executor posts only the last message's text; `tools` never leave here.
  features: { toolCalling: false },
};
