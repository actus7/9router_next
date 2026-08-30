export default {
  id: "udio",
  alias: "udio",
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your Supabase session cookie from udio.com",
  display: {
    name: "Udio",
    icon: "music_note",
    color: "#7C3AED",
    textIcon: "UD",
    website: "https://udio.com",
  },
  transport: {
    baseUrl: "https://www.udio.com/api/generate-proxy",
    authType: "cookie",
  },
  models: [
    { id: "udio-default", name: "Udio Default", kind: "music" },
  ],
  serviceKinds: ["music"],
};
