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
    // Suno renamed its internal model ids to codenames circa 2026-06-19 —
    // the old "chirp-v5"/"chirp-v5.5" ids are rejected by the upstream API.
    { id: "chirp-fenix", name: "Chirp V5.5", kind: "music" },
    { id: "chirp-crow", name: "Chirp V5", kind: "music" },
    { id: "chirp-v4", name: "Chirp V4", kind: "music" },
    { id: "chirp-v3-5", name: "Chirp V3.5", kind: "music" },
  ],
  serviceKinds: ["music"],
};
