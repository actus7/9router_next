export default {
  id: "tinycms",
  alias: "tinycms",
  aliases: ["tinycms"],
  uiAlias: "tcm",
  display: {
    name: "TinyCMS",
    icon: "article",
    color: "#14B8A6",
    textIcon: "TC",
    website: "https://tinycms.com",
    notice: "Free TinyCMS Web.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your app-config-uuid from Local Storage of tinycms.com",
  transport: {
    baseUrl: "https://tinycms.com/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "tinycms-default", name: "TinyCMS Default" },
  ],
};
