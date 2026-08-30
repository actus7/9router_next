export default {
  id: "github-models",
  alias: "ghm",
  display: {
    name: "GitHub Models",
    icon: "hub",
    color: "#8957E5",
    textIcon: "GM",
    website: "https://github.com/marketplace/models",
    notice: {
      text: "Free tier rate-limited by GitHub account level. Model ids use the publisher/model format.",
      apiKeyUrl: "https://github.com/settings/tokens",
    },
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Paste a GitHub Personal Access Token (ghp_/github_pat_...) with no extra scopes. Get one at https://github.com/settings/tokens",
  transport: {
    baseUrl: "https://models.github.ai/inference/chat/completions",
    format: "openai",
    validateUrl: "https://models.github.ai/inference/models",
  },
  modelsFetcher: { url: "https://models.github.ai/inference/catalog", type: "openai" },
};
