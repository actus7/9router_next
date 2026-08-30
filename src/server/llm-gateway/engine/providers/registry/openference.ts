export default {
  id: "openference",
  alias: "openference",
  uiAlias: "openference",
  display: {
    name: "Openference",
    icon: "hub",
    color: "#10B981",
    website: "https://openference.ai",
    notice: {
      signupUrl: "https://openference.ai",
    },
  },
  category: "oauth",
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.openference.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "openference-default", name: "Openference Default" },
  ],
  passthroughModels: true,
  oauth: {
    clientId: process.env.OPENFERENCE_OAUTH_CLIENT_ID || "",
    authorizeUrl: "https://auth.openference.ai/oauth/authorize",
    tokenUrl: "https://auth.openference.ai/oauth/token",
    scopes: ["openid", "profile", "email", "api:chat"],
    codeChallengeMethod: "S256",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
  },
};
