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
  models: [
    { id: "palmyra-x5", name: "Palmyra X5", contextLength: 1048576 },
    { id: "palmyra-x4", name: "Palmyra X4", contextLength: 131072 },
  ],
};
