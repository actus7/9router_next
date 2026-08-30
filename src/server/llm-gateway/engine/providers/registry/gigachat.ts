export default {
  id: "gigachat",
  alias: "gigachat",
  display: {
    name: "GigaChat",
    icon: "smart_toy",
    color: "#2196F3",
    textIcon: "GC",
    website: "https://developers.sber.ru/gigachat",
    notice: {
      apiKeyUrl: "https://developers.sber.ru/gigachat",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    format: "openai",
    validateUrl: "https://gigachat.devices.sberbank.ru/api/v1/models",
  },
  models: [
    { id: "GigaChat-2-Max", name: "GigaChat 2 Max" },
    { id: "GigaChat-2-Pro", name: "GigaChat 2 Pro" },
    { id: "GigaChat-2-Lite", name: "GigaChat 2 Lite" },
  ],
};
