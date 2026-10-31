export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    // The free tier answers SSE even without stream:true; chatCore then
    // converts forced SSE back to JSON when the client asked for it.
    forceStream: true,
    // Headers and transport are the executor's (executors/opencode.ts): the
    // free gate checks the v2 CLI fingerprint, TLS handshake included.
    noAuth: true,
    // Zen reasoning models reject multi-turn history whose assistant messages
    // carry no reasoning_content (400 missing_required_parameter); the client
    // never echoes it back, so a placeholder is injected.
    reasoningInject: {
      scope: "all",
    },
  },
  // The catalogue is discovered; these are the models whose endpoint is not chat.
  modelOverrides: {
    "muse-spark-1.2-contributor-free": { targetFormat: "openai-responses" },
    "muse-spark-1.3-contributor-free": { targetFormat: "openai-responses" },
    "union-alpha": { targetFormat: "claude" },
  },
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
