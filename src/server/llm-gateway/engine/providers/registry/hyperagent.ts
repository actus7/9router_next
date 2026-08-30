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
    baseUrl: "https://hyperagent.com/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "hyperagent-default", name: "HyperAgent Default" },
  ],
};
