export default {
  id: "cursor",
  priority: 50,
  alias: "cu",
  uiAlias: "cu",
  display: {
    name: "Cursor IDE",
    icon: "edit_note",
    color: "#00D4AA",
    website: "https://cursor.com",
    notice: {
      signupUrl: "https://cursor.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api2.cursor.sh",
    chatPath: "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
    format: "cursor",
    headers: {
      "connect-accept-encoding": "gzip",
      "connect-protocol-version": "1",
      "Content-Type": "application/connect+proto",
      "User-Agent": "connect-es/1.6.1",
    },
    clientVersion: "3.12.17",
  },

  oauth: {
    apiEndpoint: "https://api2.cursor.sh",
    chatEndpoint: "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
    modelsEndpoint: "/agent.v1.AgentService/GetUsableModels",
    api3Endpoint: "https://api3.cursor.sh",
    agentEndpoint: "https://agent.api5.cursor.sh",
    agentNonPrivacyEndpoint: "https://agentn.api5.cursor.sh",
    clientVersion: "3.12.17",
    clientType: "ide",
    dbKeys: {
      accessToken: "cursorAuth/accessToken",
      machineId: "storage.serviceMachineId",
    },
  },
};
