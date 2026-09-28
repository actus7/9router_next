// Ollama clients point at the host root and call `/api/chat`; same handler as
// `/v1/api/chat`, API key checked by gatewayRoute there.
export { POST, OPTIONS } from "../v1/api/chat/route";
