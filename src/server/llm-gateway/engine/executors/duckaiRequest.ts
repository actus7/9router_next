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

// DuckDuckGo rejects the chat request with 418 ERR_CHALLENGE when x-fe-signals
// carries no interaction trace: an empty `events` array with a 1ms window reads
// as "no human touched this". The first-party app sends the chat-open events
// plus a `trusted` action for the click that submitted the message, so mirror
// that shape with plausible deltas.
function buildDuckAiSignalsHeader(): string {
  const composeMs = 8_000 + Math.floor(Math.random() * 6_000);
  const start = Date.now() - composeMs;
  return Buffer.from(
    JSON.stringify({
      start,
      events: [
        { name: "startNewChat_free", delta: 90 + Math.floor(Math.random() * 60) },
        { name: "recentChatsListImpression", delta: 240 + Math.floor(Math.random() * 90) },
        { name: "action", delta: composeMs - 300, trusted: true },
      ],
      end: composeMs + 300,
    })
  ).toString("base64");
}

/** Per-conversation journey id, matching the first-party app's header. */
function buildDuckAiJourneyId(): string {
  return randomUUID().replace(/-/g, "");
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

// Every reasoning model needs an explicit reasoningEffort, and only one it
// actually declares: omitting it — or sending one the model does not support —
// is rejected with 400 ERR_BAD_REQUEST. gpt-oss is the trap here, since "low"
// is the only value it accepts. Models absent from this map are general (not
// reasoning) models that must be sent no reasoningEffort at all.
const REASONING_EFFORT_MODELS: Record<string, DuckAiReasoningEffort> = {
  "gpt-5.6-luna": "none",
  "gpt-5.4-mini": "none",
  "claude-haiku-4-5": "none",
  "tinfoil/gemma4-31b": "none",
  "tinfoil/gpt-oss-120b": "low",
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
    "x-ddg-journey-id": buildDuckAiJourneyId(),
    "x-fe-signals": buildDuckAiSignalsHeader(),
    // The build stamp the duck.ai app sends on every chat call. The challenge
    // is validated against it, so a request without it reads as not coming
    // from the app at all.
    ...(input.vqdData.feVersion ? { "x-fe-version": input.vqdData.feVersion } : {}),
    "x-vqd-hash-1": input.vqdData.hashPayload,
  };
  const requestBody: Record<string, unknown> = {
    model: input.modelId,
    // The two roles take different shapes, and the asymmetry is load-bearing:
    // a user turn must be a content part array, an assistant turn must be a
    // bare string. Sending the array for both is answered with 400
    // ERR_BAD_REQUEST — and because the body is validated before the
    // challenge, it only surfaces once the challenge passes. Sending the
    // string for both fails the same way on the user turn.
    //
    // The practical effect of getting this wrong is narrow enough to slip
    // through a smoke test: the first message of a conversation carries no
    // assistant turn and succeeds, so only the second message onwards breaks.
    messages: input.messages.map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? m.content : [{ type: "text", text: m.content }],
    })),
    canUseTools: true,
    canUseApproxLocation: null,
    canDelegateImageGeneration: null,
    canShowGreeting: true,
    durableStream: input.durableStream,
    metadata: {
      toolChoice: buildDuckAiToolChoice(),
    },
  };

  // The app always sends the field, "none" for models without a reasoning
  // mode; omitting it entirely is rejected.
  requestBody.reasoningEffort = input.reasoningEffort ?? "none";

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


