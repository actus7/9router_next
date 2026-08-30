export default {
  id: "adobe-firefly",
  priority: 150,
  alias: "afw",
  aliases: [
    "afw",
  ],
  uiAlias: "afw",
  display: {
    name: "Adobe Firefly",
    icon: "auto_awesome",
    color: "#FF0000",
    textIcon: "AFW",
    website: "https://firefly.adobe.com",
    notice: "Adobe Firefly. Image/video generation via web session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your IMS cookie or Bearer JWT from firefly.adobe.com",
  transport: {
    baseUrl: "https://firefly.adobe.com/api/v1/images/generate",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "firefly-image", name: "Firefly Image", kind: "image" },
    { id: "firefly-video", name: "Firefly Video", kind: "video" },
  ],
  passthroughModels: true,
};
