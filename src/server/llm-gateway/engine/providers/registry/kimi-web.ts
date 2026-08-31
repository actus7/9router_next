export default {
  id: "kimi-web",
  alias: "kimiw",
  uiAlias: "kimiw",
  display: {
    name: "Kimi Web",
    icon: "psychology",
    color: "#7C3AED",
    textIcon: "KW",
    website: "https://kimi.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from Local Storage of www.kimi.ai",
  notice: "Kimi Web session. Uses Connect-RPC binary framing, not plain SSE.",
  transport: {
    baseUrl: "https://www.kimi.ai/apiv2/kimi.gateway.chat.v1.ChatService/Chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "k3", name: "K3" },
    { id: "k2d6", name: "K2.6" },
  ],
};
