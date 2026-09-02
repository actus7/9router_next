export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  // Fallback catalogue used when upstream discovery is temporarily unavailable.
  // Keep it aligned with the free Zen catalogue so chat never collapses to one
  // model while the provider screen still has the discovered entries.
  models: [
    { id: "big-pickle", name: "Big Pickle (OpenCode)" },
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free (OpenCode)" },
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free (OpenCode)" },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free (OpenCode)" },
    { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free (OpenCode)" },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free (OpenCode)" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free (OpenCode)" },
    { id: "laguna-s-2.1-free", name: "Laguna S 2.1 Free (OpenCode)" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
