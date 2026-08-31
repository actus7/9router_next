export default {
  id: "muse-spark-web",
  alias: "msw",
  uiAlias: "msw",
  display: {
    name: "Meta AI (Free)",
    icon: "smart_toy",
    color: "#0668E1",
    textIcon: "MS",
    website: "https://meta.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your ecto_1_sess cookie AND the ecto1:... WS auth token from meta.ai DevTools (Network → WS → clippy request → Authorization param), separated by a space or semicolon",
  notice: "Free Meta AI (Muse Spark). Requires both the ecto_1_sess cookie and a live WS auth token — see auth hint.",
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "muse-spark-1.2", name: "Muse Spark 1.2" },
    { id: "muse-spark-thinking", name: "Muse Spark Thinking" },
    { id: "muse-spark-contemplating", name: "Muse Spark Contemplating" },
  ],
  passthroughModels: true,
};
