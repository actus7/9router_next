import { CLAUDE_API_HEADERS } from "../shared";

export default {
  id: "glm",
  priority: 140,
  alias: "glm",
  display: {
    name: "GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    usage: {
      url: "https://api.z.ai/api/monitor/usage/quota/limit",
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  // Discovered catalogue (see PROVIDER_MODELS_CONFIG — the coding plan answers a
  // live OpenAI listing at /api/coding/paas/v4/models). modelOverrides carries
  // only the display names, which the listing does not return.
  modelOverrides: {
    "glm-5.3": { name: "GLM 5.3" },
    "glm-5.2": { name: "GLM 5.2" },
    "glm-5.1": { name: "GLM 5.1" },
    "glm-5": { name: "GLM 5" },
    "glm-4.7": { name: "GLM 4.7" },
    "glm-4.6v": { name: "GLM 4.6V (Vision)" },
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
