export default {
  id: "aihorde",
  alias: "ah",
  aliases: ["horde"],
  uiAlias: "AH",
  display: {
    name: "AI Horde",
    icon: "groups",
    color: "#8B5CF6",
    textIcon: "AH",
    website: "https://aihorde.net",
    notice: {
      text: "Free community-powered inference (volunteer workers). Anonymous access with sentinel key 0000000000 (lowest queue priority). No tool calling support.",
      apiKeyUrl: "https://aihorde.net/register",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://oai.aihorde.net/v1/chat/completions",
    timeoutMs: 120000,
    modelsFetcher: { url: "https://oai.aihorde.net/v1/models", type: "openai" },
  },
  // Seed from the live /v1/models catalog (verified 2026-08: these ids are served
  // by online workers; stale ids 406 with "Model None not known").
  models: [
    { id: "aphrodite/TheDrummer/Skyfall-31B-v4.2", name: "Skyfall 31B v4.2" },
    { id: "aphrodite/TheDrummer/Cydonia-24B-v4.3", name: "Cydonia 24B v4.3" },
    { id: "koboldcpp/Llama-3.2-3B", name: "Llama 3.2 3B" },
    { id: "koboldcpp/mini-magnum-12b-v1.1", name: "Mini Magnum 12B" },
  ],
};
