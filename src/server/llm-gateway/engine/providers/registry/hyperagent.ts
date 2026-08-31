export default {
  id: "hyperagent",
  alias: "hyperagent",
  aliases: ["hyperagent"],
  uiAlias: "hyper",
  display: {
    name: "HyperAgent",
    icon: "smart_toy",
    color: "#F97316",
    textIcon: "HA",
    website: "https://hyperagent.com",
    notice: "Experimental HyperAgent session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full cookie from hyperagent.com",
  transport: {
    baseUrl: "https://hyperagent.com/api/threads",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
  ],
};
