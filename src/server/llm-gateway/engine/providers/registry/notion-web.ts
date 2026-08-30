export default {
  id: "notion-web",
  alias: "nw",
  aliases: ["notion-web"],
  uiAlias: "nw",
  display: {
    name: "Notion AI",
    icon: "auto_awesome",
    color: "#000000",
    textIcon: "NW",
    website: "https://www.notion.so",
    notice: "Unofficial Notion AI. Endpoint not documented.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your token_v2 from app.notion.com",
  transport: {
    baseUrl: "https://www.notion.so/api/v3/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "notion-default", name: "Notion Default" },
  ],
  passthroughModels: true,
};
