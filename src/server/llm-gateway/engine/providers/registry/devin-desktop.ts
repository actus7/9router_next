export default {
  id: "devin-desktop",
  alias: "devindesk",
  uiAlias: "devindesk",
  display: {
    name: "Devin Desktop",
    icon: "desktop_windows",
    color: "#14B8A6",
    website: "https://devin.ai",
    notice: {
      apiKeyUrl: "https://devin.ai/settings/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.devin.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "devin-default", name: "Devin Default" },
  ],
};
