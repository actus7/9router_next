export default {
  id: "xkiro",
  alias: "xk",
  display: {
    name: "xKiro",
    icon: "rocket_launch",
    color: "#F97316",
    textIcon: "XK",
    website: "https://xkiro.com",
    notice: {
      text: "5M tokens/day free. Free key from xkiro.com, no card.",
      apiKeyUrl: "https://xkiro.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.xkiro.com/v1/chat/completions",
    // GET /v1/models is public (200 even with revoked key) — validate against
    // the authenticated /v1/usage endpoint instead.
    validateUrl: "https://api.xkiro.com/v1/usage",
  },
  modelsFetcher: { url: "https://api.xkiro.com/v1/models", type: "openai" },
};
