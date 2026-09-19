
export default {
  id: "codex",
  priority: 30,
  alias: "cx",
  uiAlias: "cx",
  display: {
    name: "OpenAI Codex",
    icon: "code",
    color: "#3B82F6",
    website: "https://chatgpt.com/codex",
    notice: {
      signupUrl: "https://chatgpt.com/codex",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
    kindNotice: {
      image: "Requires a ChatGPT Plus (or higher) account. Free accounts are not supported for image generation.",
    },
  },
  category: "oauth",
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    format: "openai-responses",
    forceStream: true,
    headers: {
      originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/0.136.0",
    },
    usage: {
      url: "https://chatgpt.com/backend-api/wham/usage",
      resetCreditsUrl: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      resetCreditsConsumeUrl: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
    },
  },
    modelOverrides: {
    "gpt-5.6-sol-review": { "upstreamModelId": "gpt-5.6-sol", "quotaFamily": "review" },
    "gpt-5.6-terra-review": { "upstreamModelId": "gpt-5.6-terra", "quotaFamily": "review" },
    "gpt-5.6-luna-review": { "upstreamModelId": "gpt-5.6-luna", "quotaFamily": "review" },
    "gpt-5.5-review": { "upstreamModelId": "gpt-5.5", "quotaFamily": "review" },
    "gpt-5.4-review": { "upstreamModelId": "gpt-5.4", "quotaFamily": "review" },
    "gpt-5.4-mini-review": { "upstreamModelId": "gpt-5.4-mini", "quotaFamily": "review" },
    "gpt-5.3-codex-spark-review": { "upstreamModelId": "gpt-5.3-codex-spark", "quotaFamily": "review" },
    "gpt-5.5-image": { "capabilities": ["text2img", "edit"], "params": ["size", "quality", "background", "image_detail", "output_format"], "kind": "image" },
    "gpt-5.4-image": { "capabilities": ["text2img", "edit"], "params": ["size", "quality", "background", "image_detail", "output_format"], "kind": "image" },
    "gpt-5.3-image": { "capabilities": ["text2img", "edit"], "params": ["size", "quality", "background", "image_detail", "output_format"], "kind": "image" },
  },
  serviceKinds: ["llm","image"],
  oauth: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scope: "openid profile email offline_access",
    codeChallengeMethod: "S256",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
    extraParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
    },
    refreshLeadMs: 432000000,
    refresh: {
      encoding: "form",
      scope: "openid profile email offline_access",
    },
    maxRefreshAgeMs: 691200000,
    trackRefreshAt: true,
  },
  features: {
    usage: true,
  },
};
