export default {
  id: "agy",
  alias: "agy",
  uiAlias: "agy",
  display: {
    name: "Antigravity CLI",
    icon: "rocket_launch",
    color: "#8B5CF6",
    website: "https://antigravity.ai",
    notice: {
      signupUrl: "https://antigravity.ai",
    },
  },
  category: "oauth",
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.antigravity.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "agy-default", name: "Antigravity Default" },
  ],
  oauth: {
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || "",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/cloud-platform",
    ],
    codeChallengeMethod: "S256",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
  },
};
