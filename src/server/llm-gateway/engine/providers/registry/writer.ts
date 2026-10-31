export default {
  id: "writer",
  alias: "writer",
  display: {
    name: "Writer",
    icon: "bolt",
    color: "#8B5CF6",
    textIcon: "WR",
    website: "https://writer.com",
    notice: {
      apiKeyUrl: "https://writer.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.writer.com/v1/chat/completions",
    format: "openai",
  },
};
