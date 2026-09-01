import crypto from "crypto";
import zlib from "zlib";
import { encodeField, wrapConnectRPCFrame } from "../utils/cursorProtobuf";

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03
};

export const AGENT_RUN_PATH = "/agent.v1.AgentService/Run";
const PROTOBUF_LEN = 2;
const PROTOBUF_VARINT = 0;

function concatBuffers(...parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const agentString = (field: number, value: string) => encodeField(field, PROTOBUF_LEN, value);
const agentMessage = (field: number, value: Uint8Array) => encodeField(field, PROTOBUF_LEN, value);
const agentBool = (field: number, value: boolean) => encodeField(field, PROTOBUF_VARINT, value ? 1 : 0);

function textFromContent(content: string | Record<string, unknown>[]) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: Record<string, unknown>) => part?.type === "text" && typeof part.text === "string")
    .map((part: Record<string, unknown>) => part.text as string)
    .join("\n");
}

export function isAgentTextRequest(body: Record<string, unknown>) {
  // Many compatible clients always attach their built-in tool schemas, even
  // for a normal text turn. Cursor's retired ChatService rejects those
  // requests; AgentService can still answer the text turn, so ignore schemas
  // here. A real tool-call/result conversation is kept on the legacy path
  // until its AgentService tool protocol is implemented.
  return Array.isArray(body?.messages) && (body.messages as Record<string, unknown>[]).every((message: Record<string, unknown>) => {
    if ((message?.tool_calls as unknown[])?.length || message?.role === "tool") return false;
    return typeof message?.content === "string"
      || Array.isArray(message?.content) && (message.content as Record<string, unknown>[]).every((part: Record<string, unknown>) => part?.type === "text");
  });
}

function encodeHistoryMessage(message: Record<string, unknown>) {
  const content = textFromContent(message?.content as string | Record<string, unknown>[]);
  if (!content) return null;

  // ConversationHistoryMessage.user / .assistant -> repeated content -> text.
  const text = agentString(1, content);
  if (message.role === "assistant") {
    return agentMessage(2, agentMessage(1, agentMessage(1, text)));
  }
  return agentMessage(1, agentMessage(1, agentMessage(1, text)));
}

export function buildAgentRunFrame(messages: Record<string, unknown>[], model: string) {
  const system = (messages as Record<string, unknown>[])
    .filter((message: Record<string, unknown>) => message?.role === "system")
    .map((message: Record<string, unknown>) => textFromContent(message.content as string | Record<string, unknown>[]))
    .filter(Boolean)
    .join("\n\n");
  const chatMessages = (messages as Record<string, unknown>[]).filter((message: Record<string, unknown>) => message?.role !== "system");
  const currentIndex = [...chatMessages].map((message: Record<string, unknown>) => message?.role as string).lastIndexOf("user");
  const current = currentIndex >= 0 ? chatMessages[currentIndex] : chatMessages.at(-1);
  const history = chatMessages
    .slice(0, currentIndex >= 0 ? currentIndex : -1)
    .map(encodeHistoryMessage)
    .filter(Boolean);
  const userText = textFromContent((current as Record<string, unknown>)?.content as string | Record<string, unknown>[]) || "Continue.";

  // agent.v1.UserMessageAction.user_message and its optional history.
  const userMessage = concatBuffers(
    agentString(1, userText),
    agentString(2, crypto.randomUUID()),
  );
  const conversationHistory = history.length
    ? concatBuffers(...(history as Uint8Array[]).map((entry: Uint8Array) => agentMessage(1, entry)))
    : null;
  const userAction = concatBuffers(
    agentMessage(1, userMessage),
    ...(conversationHistory ? [agentMessage(7, conversationHistory)] : []),
  );
  const conversationAction = agentMessage(1, userAction);
  const requestedModel = concatBuffers(agentString(1, model), agentBool(7, true));
  const runRequest = concatBuffers(
    // An empty ConversationStateStructure starts a fresh local agent session.
    agentMessage(1, new Uint8Array()),
    agentMessage(2, conversationAction),
    ...(system ? [agentString(8, system)] : []),
    agentMessage(9, requestedModel),
  );

  // agent.v1.AgentClientMessage.run_request.
  return wrapConnectRPCFrame(agentMessage(1, runRequest));
}

export function extractAgentString(message: { get(field: number): { value: unknown }[] | undefined }, field: number) {
  const value = message?.get(field)?.[0]?.value;
  return value ? Buffer.from(value as Uint8Array).toString("utf8") : "";
}

export function decodeAgentFrames(buffer: Buffer | Uint8Array | null, onFrame: (frame: Uint8Array) => void) {
  let pending = Buffer.from(buffer || []);
  while (pending.length >= 5) {
    const flags = pending[0];
    const length = pending.readUInt32BE(1);
    if (pending.length < 5 + length) break;
    let payload = pending.subarray(5, 5 + length);
    pending = pending.subarray(5 + length);
    if (flags & COMPRESS_FLAG.GZIP) {
      payload = zlib.gunzipSync(payload);
    }
    if (!(flags & COMPRESS_FLAG.TRAILER)) onFrame(payload);
  }
  return pending;
}

export function createRequestContextResponse() {
  // AgentService asks every run for client context. modelhub has no IDE file
  // context, so acknowledge with an empty RequestContext.
  const requestContextSuccess = agentMessage(1, new Uint8Array());
  const requestContextResult = agentMessage(1, requestContextSuccess);
  const execClientMessage = agentMessage(10, requestContextResult);
  return wrapConnectRPCFrame(agentMessage(2, execClientMessage));
}

