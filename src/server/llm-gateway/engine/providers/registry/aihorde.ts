export default {
  id: "aihorde",
  alias: "ah",
  aliases: ["horde"],
  uiAlias: "ah",
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
  authType: "apikey",
  noAuth: true,
  transport: {
    baseUrl: "https://oai.aihorde.net/v1/chat/completions",
    timeoutMs: 120000,
  },
  // Confirmed available by the public model catalogue. Horde availability is
  // queue-based, so callers must still surface retryable queue failures.
  models: [
    { id: "aphrodite/SicariusSicariiStuff/Impish_Bloodmoon_12B", name: "Impish Bloodmoon 12B (AI Horde)" },
  ],
  modelsFetcher: { url: "https://oai.aihorde.net/v1/models", type: "openai" },
};
