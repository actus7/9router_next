export default {
  id: "duckai",
  priority: 180,
  alias: "duckai",
  aliases: ["da"],
  uiAlias: "da",
  display: {
    name: "Duck.ai",
    icon: "smart_toy",
    color: "#DE5833",
    textIcon: "DA",
    website: "https://duck.ai",
    notice:
      "Anonymous web session protected by anti-bot challenge (VQD), solved in-process with jsdom — no browser needed, serverless included. May break when DuckDuckGo rotates challenge scripts.",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://duck.ai/duckchat/v1/chat",
    format: "duckai",
    noAuth: true,
  },
  models: [
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna (Duck.ai)", capabilities: { vision: true } },
    { id: "gpt-5.4-mini", name: "GPT-5.4 mini (Duck.ai)", capabilities: { vision: true } },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Duck.ai)", capabilities: { vision: true } },
    { id: "tinfoil/gemma4-31b", name: "Gemma 4 31B (Duck.ai)", capabilities: { vision: true } },
    { id: "tinfoil/gpt-oss-120b", name: "gpt-oss 120B (Duck.ai)" },
    { id: "mistral-small-2603", name: "Mistral Small 4 (Duck.ai)" },
  ],
  // No models-list endpoint — duck.ai is a scraped anonymous web session, not a
  // public API, so this list is maintained by hand. It mirrors the entries the
  // duck.ai bundle marks `availableTo: [Free, ...]`; the tiered ones (gpt-5.4,
  // gpt-5.6-sol/terra, claude-sonnet-4-6, claude-opus-4-8) answer 404 without a
  // subscription, and retired ids answer 404 too. To refresh, read the model
  // table out of https://duck.ai/dist/duckai-dist/entry.duckai.*.js and keep the
  // Free ones — then check REASONING_EFFORT_MODELS in duckaiRequest.ts, since
  // each entry also declares which reasoningEffort values it accepts.
  noModelDiscovery: true,
};
