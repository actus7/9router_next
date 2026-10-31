// Xiaomi ended the free MiMo channel ("MiMo free API service has ended").
// Retired until/unless a replacement (OAuth MiMo Platform) is wired.
export default {
  id: "mimo-free",
  retired: { reason: "A Xiaomi encerrou o canal grátis do MiMo; o upstream recusa os modelos", since: "2026-10-31" },
  priority: 50,
  hasFree: true,
  alias: "mmf",
  uiAlias: "mmf",
  display: {
    name: "MiMo Code Free",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MF",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
  passthroughModels: true,
};
