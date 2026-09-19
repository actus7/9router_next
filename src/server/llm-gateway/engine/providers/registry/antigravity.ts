import { ANTIGRAVITY_IDE_BASE_URL, ANTIGRAVITY_IDE_USER_AGENT } from "../shared";

export default {
  id: "antigravity",
  priority: 20,
  alias: "ag",
  uiAlias: "ag",
  display: {
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    website: "https://antigravity.google",
    notice: {
      signupUrl: "https://antigravity.google",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  serviceKinds: ["llm", "image"],
  transport: {
    baseUrls: [ANTIGRAVITY_IDE_BASE_URL],
    format: "antigravity",
    headers: {
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
    },
    retry: {
      "429": {
        attempts: 3,
      },
      "500": {
        attempts: 3,
      },
      "503": {
        attempts: 3,
      },
    },
    usage: {
      // Discovery (quota/project) on PROD; daily host rejects these.
      quotaApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || "",
  },
    modelOverrides: {
    "gemini-3.7-flash-high": { "upstreamModelId": "gemini-3.7-flash-tiered(high)" },
    "gemini-3.7-flash-medium": { "upstreamModelId": "gemini-3.7-flash-tiered(medium)" },
    "gemini-3.7-flash-low": { "upstreamModelId": "gemini-3.7-flash-tiered(low)" },
    "gemini-3.6-flash-high": { "upstreamModelId": "gemini-3.6-flash-tiered(high)" },
    "gemini-3.6-flash-medium": { "upstreamModelId": "gemini-3.6-flash-tiered(medium)" },
    "gemini-3.6-flash-low": { "upstreamModelId": "gemini-3.6-flash-tiered(low)" },
    "gemini-3-flash": { "thinking": false },
    "gemini-3.1-flash-image": { "kind": "image", "imageGen": true, "capabilities": ["textToImage"] },
  },
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    apiEndpoint: "https://daily-cloudcode-pa.googleapis.com",
    apiVersion: "v1internal",
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    onboardUserEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    loadCodeAssistUserAgent: ANTIGRAVITY_IDE_USER_AGENT,
    refreshLeadMs: 300000,
  },
  features: {
    usage: true,
  },
};
