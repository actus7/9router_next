export default {
  id: "poe-web",
  alias: "poew",
  uiAlias: "poew",
  display: {
    name: "Poe Web",
    icon: "auto_awesome",
    color: "#6C5CE7",
    textIcon: "PW",
    website: "https://poe.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your p-b cookie from poe.com",
  notice: "Poe Web session.",
  transport: {
    baseUrl: "https://www.poe.com/api/gql_POST",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "GPT-5.2", name: "GPT-5.2" },
    { id: "Claude-Opus-4.8", name: "Claude Opus 4.8" },
    { id: "Gemini-3.0-Pro", name: "Gemini 3.0 Pro" },
  ],
  passthroughModels: true,
};
