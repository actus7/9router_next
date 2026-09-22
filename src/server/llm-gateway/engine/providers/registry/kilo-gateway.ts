export default {
  id: "kilo-gateway",
  alias: "kgw",
  aliases: [
    "kilo-gateway",
    "kilogateway",
  ],
  uiAlias: "kgw",
  category: "freeTier",
  display: {
    name: "Kilo Gateway",
    icon: "login",
    color: "#8B5CF6",
    textIcon: "KG",
    website: "https://kilo.ai",
    notice: {
      text: "Free models work without a key (200 requests/hour per IP — on Vercel that is the platform's shared egress IP, so the quota is shared with every account here and with other Vercel projects) and are the platform's credential-free default. Kilo warns that its free router may send prompts to providers that log them — do not send confidential data through free models. Add your own key to lift the anonymous limit.",
      apiKeyUrl: "https://app.kilo.ai/profile",
    },
  },
  authType: "apikey",
  authModes: ["apikey"],
  // Kilo serves its free models without authentication (200 requests/hour per
  // IP): an account with no Kilo connection still reaches these, with no
  // Authorization header. Paid models answer 401 anonymously, so only ids that
  // match are offered — see `isAnonymousFreeModel`.
  features: { anonymousFreeModels: true },
  transport: {
    baseUrl: "https://api.kilo.ai/api/gateway/chat/completions",
    validateUrl: "https://api.kilo.ai/api/gateway/models",
  },

};
