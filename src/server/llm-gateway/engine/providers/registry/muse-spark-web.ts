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
  authHint: "Paste your ecto_1_sess cookie from meta.ai",
  notice: "Free Meta AI (Muse Spark). Emulated tool calling.",
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "muse-spark-1.2", name: "Muse Spark 1.2" },
  ],
  passthroughModels: true,
};
