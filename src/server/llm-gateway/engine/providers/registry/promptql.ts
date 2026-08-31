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
  authHint: "Paste your Bearer JWT from prompt.ql.app (DevTools → Network → graphql on data.prompt.ql.app, iss=enrich-token — not the DDN/project token)",
  transport: {
    baseUrl: "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "promptql-default", name: "PromptQL Default" },
  ],
};
