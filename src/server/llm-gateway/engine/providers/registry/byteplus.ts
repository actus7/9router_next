export default {
  id: "byteplus",
  priority: 70,
  alias: "byteplus",
  aliases: [
    "bpm",
  ],
  uiAlias: "bpm",
  display: {
    name: "BytePlus ModelArk",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "BP",
    website: "https://console.byteplus.com/ark",
    notice: {
      text: "Free credits for new accounts. Access to Seed 2.0, Kimi K2 Thinking, GLM 4.7, GPT-OSS-120B models.",
      apiKeyUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
    },
  },
  category: "freeTier",
  transport: {
    // Standard ModelArk endpoint (pay-as-you-go / free credits) — NOT the Coding Plan
    // endpoint (api/coding/v3), which requires a CodingPlan subscription and returns
    // InvalidSubscription for regular API keys. Coding-plan users should use the
    // dedicated `volcengine-coding-plan` (vcp) provider instead.
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
    validateUrl: "https://ark.ap-southeast.bytepluses.com/api/v3/models",
    headers: {},
  },

  serviceKinds: ["llm"],
};
