export default {
  id: "suno",
  alias: "suno",
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your Clerk session cookie from suno.ai",
  display: {
    name: "Suno",
    icon: "music_note",
    color: "#F59E0B",
    textIcon: "SN",
    website: "https://suno.ai",
  },
  transport: {
    baseUrl: "https://studio-api.suno.ai/api/generate/v2/",
    authType: "cookie",
  },
  models: [
    { id: "chirp-v5", name: "Chirp V5", kind: "music" },
    { id: "chirp-v5.5", name: "Chirp V5.5", kind: "music" },
  ],
  serviceKinds: ["music"],
};
