export default {
  id: "mmf",
  alias: "mmf-legacy",
  retired: { reason: "A Xiaomi encerrou o canal grátis do MiMo; o upstream responde \"Unsupported model\" a todo modelo", since: "2026-10-31" },
  priority: 200,
  display: {
    name: "MMF",
    icon: "hub",
    color: "#6366F1",
    textIcon: "MF",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  models: [
    { id: "mimo-auto", name: "MiMo Auto" },
  ],
};
