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
  modelsFetcher: { url: "https://oai.aihorde.net/v1/models", type: "openai" },
};
