export default {
  id: "gemini-business",
  priority: 150,
  alias: "gmb",
  aliases: [
    "gmb",
  ],
  uiAlias: "gmb",
  display: {
    name: "Gemini Business (Enterprise)",
    icon: "auto_awesome",
    color: "#4285F4",
    textIcon: "GMB",
    website: "https://business.gemini.google.com",
    notice: "Gemini Business (Enterprise) SSO session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-1PSID and __Secure-1PSIDTS cookies from business.gemini.google, plus your enterprise entry URL (business.gemini.google/home/cid/{CID}) as providerSpecificData.entryUrl",
  transport: {
    baseUrl: "https://business.gemini.google/home",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "gemini-3-pro", name: "Gemini 3 Pro" },
  ],
  passthroughModels: true,
};
