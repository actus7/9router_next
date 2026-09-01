import { randomUUID, webcrypto } from "node:crypto";
import {
  CHAT_URL,
  STATUS_HEADERS,
  type DdgMessage,
  type DuckAiReasoningEffort,
  type DuckAiVqdData,
  appendResponseCookies,
  fetchWithTimeout,
} from "./duckaiRuntime";

function buildDuckAiSignalsHeader(): string {
  const start = Date.now();
  const end = start + 1;
  return Buffer.from(JSON.stringify({ end, events: [], start })).toString("base64");
}

function buildDuckAiToolChoice() {
  return {
    LocalSearch: false,
    NewsSearch: false,
    VideosSearch: false,
    WeatherForecast: false,
  };
}

export async function buildDuckAiDurableStreamPayload(): Promise<{
  conversationId: string;
  messageId: string;
  publicKey: JsonWebKey;
}> {
  const keyPair = (await webcrypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  )) as CryptoKeyPair;

  const publicKey = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);

  return {
    conversationId: randomUUID(),
    messageId: randomUUID(),
    publicKey: {
      ...publicKey,
      alg: "RSA-OAEP-256",
      ext: true,
      key_ops: ["encrypt"],
      use: "enc",
    },
  };
}

export function toDdgMessages(
  messages: Record<string, unknown>[]
): DdgMessage[] {
  const result: DdgMessage[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = (m.content as Record<string, unknown>[])
        .filter((c) => c.type === "text")
        .map((c) => String((c as Record<string, unknown>).text || ""))
        .join(" ");
    }
    if (!content.trim()) continue;
    result.push({ role, content });
  }
  return result;
}

// Model IDs known to support reasoning effort
const REASONING_EFFORT_MODELS: Record<string, DuckAiReasoningEffort> = {
  "gpt-5-mini": "minimal",
};

export function getReasoningEffort(modelId: string): DuckAiReasoningEffort | undefined {
  return REASONING_EFFORT_MODELS[modelId];
}

export async function sendDuckAiChatRequest(input: {
  cookies: string;
  durableStream: Awaited<ReturnType<typeof buildDuckAiDurableStreamPayload>>;
  messages: DdgMessage[];
  modelId: string;
  reasoningEffort?: DuckAiReasoningEffort;
  vqdData: DuckAiVqdData;
  signal?: AbortSignal;
}): Promise<{ cookies: string; response: Response }> {
  const chatHeaders: Record<string, string> = {
    ...STATUS_HEADERS,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    ...(input.cookies ? { Cookie: input.cookies } : {}),
    Origin: "https://duck.ai",
    "x-fe-signals": buildDuckAiSignalsHeader(),
    "x-vqd-hash-1": input.vqdData.hashPayload,
  };
  const requestBody: Record<string, unknown> = {
    model: input.modelId,
    messages: input.messages,
    canUseTools: true,
    canUseApproxLocation: null,
    durableStream: input.durableStream,
    metadata: {
      toolChoice: buildDuckAiToolChoice(),
    },
  };

  if (input.reasoningEffort) {
    requestBody.reasoningEffort = input.reasoningEffort;
  }

  const response = await fetchWithTimeout(
    CHAT_URL,
    {
      method: "POST",
      headers: chatHeaders,
      body: JSON.stringify(requestBody),
      signal: input.signal,
    },
    60000
  );

  return {
    cookies: appendResponseCookies(input.cookies, response.headers),
    response,
  };
}

// ---------------------------------------------------------------------------
// SSE stream conversion: Duck.ai → OpenAI chat.completion.chunk
// ---------------------------------------------------------------------------

/** Flush remaining SSE buffer when the upstream stream ends. */




// ---------------------------------------------------------------------------
// Stream priming: detect early errors before committing to SSE
// ---------------------------------------------------------------------------


