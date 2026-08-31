export default {
  id: "zai-web",
  alias: "zaiw",
  aliases: ["zai-web", "zaiw"],
  uiAlias: "zai",
  display: {
    name: "Z.ai Web",
    icon: "language",
    color: "#EF4444",
    textIcon: "ZA",
    website: "https://chat.z.ai",
    notice: "Z.ai Web session (signed API). Requires both the localStorage token AND a captcha_verify_param captured from a real browser request — paste as JSON: {\"token\":\"...\",\"captcha_verify_param\":\"...\"}. No image/vision support (browser-only upstream feature).",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste {\"token\":\"<localStorage token>\",\"captcha_verify_param\":\"<captured from DevTools Network tab>\"}",
  transport: {
    baseUrl: "https://chat.z.ai/api/v2/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5-turbo", name: "GLM-5 Turbo" },
  ],
};
