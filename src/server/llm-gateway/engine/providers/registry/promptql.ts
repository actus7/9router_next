export default {
  id: "promptql",
  alias: "promptql",
  aliases: ["promptql"],
  uiAlias: "pql",
  display: {
    name: "PromptQL",
    icon: "query_stats",
    color: "#8B5CF6",
    textIcon: "PQ",
    website: "https://promptql.com",
    notice: "Experimental PromptQL session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your Bearer JWT from promptql.com graphql endpoint",
  transport: {
    baseUrl: "https://promptql.com/api/graphql",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "promptql-default", name: "PromptQL Default" },
  ],
};
