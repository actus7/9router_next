// PromptQL (prompt.ql.app) executor — unofficial/experimental playground agent.
//
// The previous version of this executor pointed at "promptql.com/api/graphql"
// (a domain that doesn't run this product) calling a `chat(input: ChatInput!)`
// mutation that doesn't exist. The real API lives at
// data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql and is
// fundamentally asynchronous: `start_thread`/`send_thread_message` only
// acknowledge the user's turn — the assistant's reply arrives later as an
// AgentMessage row on `thread_events`, discovered by polling. Ported from
// OmniRoute's promptql.ts (thread-stickiness across separate HTTP requests
// and the cookie-based token-refresh path were left out — this project has no
// cross-request thread store; the full message history is folded into the
// prompt on every call instead, which keeps multi-turn correct without it).
import { BaseExecutor } from "./base";
import type { Credentials, Logger } from "../services/types";

const PLAYGROUND_GQL = "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 180_000;

const START_THREAD_ROOMLESS = `
mutation StartThreadRoomless($message: String!, $projectId: String!, $timezone: String!, $agentResponseConfig: String) {
  start_thread(message: $message, projectId: $projectId, timezone: $timezone, roomless: true, uploads: [], agentResponseConfig: $agentResponseConfig) {
    thread_id
    thread_events { thread_event_id created_at event_data }
  }
}`;

const QUERY_THREAD_EVENTS = `
query QueryThreadEvents($thread_id: uuid!, $after_event_id: bigint!) {
  thread_events(where: { thread_id: {_eq: $thread_id}, thread_event_id: {_gt: $after_event_id} }, order_by: {thread_event_id: asc}) {
    thread_event_id
    event_data
    created_at
  }
}`;

interface ThreadEvent {
  thread_event_id: string | number;
  event_data?: unknown;
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), { status, headers: { "Content-Type": "application/json" } });
}

/** Bare-bones JWT payload decode (base64url, no signature verification —
 * we're only reading claims, not trusting the token for auth ourselves). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== "number") return false;
  return Date.now() >= exp * 1000;
}

function extractProjectIdFromToken(token: string): string {
  const payload = decodeJwtPayload(token);
  if (!payload) return "";
  const hasura = payload["https://promptql.hasura.io"] as Record<string, unknown> | undefined;
  const claim = hasura?.["x-hasura-project-id"] ?? payload["x-hasura-project-id"] ?? payload.aud;
  return typeof claim === "string" ? claim : "";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const p = part as Record<string, unknown>;
    return typeof p?.text === "string" ? p.text : "";
  }).filter(Boolean).join("\n");
}

/** Fold the full OpenAI history into one prompt — PromptQL threads are stateful
 * server-side, but we start a fresh thread per request (no cross-request store),
 * so the model needs the whole conversation in the message text itself. */
function foldHistoryIntoPrompt(messages: Array<{ role: string; content: unknown }>): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const text = extractText(msg.content);
    if (!text) continue;
    const role = String(msg.role || "user");
    parts.push(role === "user" ? text : `${role}: ${text}`);
  }
  return parts.join("\n\n");
}

async function gql<T = unknown>(token: string, query: string, variables: Record<string, unknown>, operationName: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(PLAYGROUND_GQL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: "https://prompt.ql.app",
      referer: "https://prompt.ql.app/",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ query, variables, operationName }),
    signal,
  });
  const text = await res.text();
  let json: { data?: T; errors?: Array<{ message?: string }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 400)}`);
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message || "error").join("; "));
  return json.data as T;
}

function walkStrings(node: unknown, out: Array<{ path: string; text: string }> = [], path = ""): Array<{ path: string; text: string }> {
  if (node == null) return out;
  if (typeof node === "string") {
    if (node.length >= 1 && !/^[0-9a-f-]{36}$/i.test(node) && !/^\d{4}-\d{2}-\d{2}T/.test(node)) out.push({ path, text: node });
    return out;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walkStrings(v, out, `${path}[${i}]`)); return out; }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walkStrings(v, out, path ? `${path}.${k}` : k);
  }
  return out;
}

function extractFinalResponseMessage(eventData: unknown): string | null {
  const hits = walkStrings(eventData).filter((t) => /final_response\.message$/i.test(t.path));
  if (hits.length) return hits[hits.length - 1].text;
  const raw = walkStrings(eventData).find((t) => /response_text$/i.test(t.path));
  if (raw) {
    const m = raw.text.match(/<final_response>\s*([\s\S]*?)\s*<\/final_response>/i);
    if (m) return m[1].trim();
  }
  return null;
}

async function pollAssistantText(token: string, threadId: string, afterEventId: string, signal?: AbortSignal): Promise<string> {
  const start = Date.now();
  let cursor = afterEventId;
  let best = "";
  let sawFinal = false;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("aborted");
    const data = await gql<{ thread_events: ThreadEvent[] }>(token, QUERY_THREAD_EVENTS, { thread_id: threadId, after_event_id: cursor }, "QueryThreadEvents", signal);
    for (const ev of data.thread_events || []) {
      cursor = String(ev.thread_event_id);
      const msg = extractFinalResponseMessage(ev.event_data);
      if (msg) best = msg;
      if (JSON.stringify(ev.event_data || {}).includes("final_response_sent")) sawFinal = true;
    }
    if (sawFinal && best) return best;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (best) return best;
  throw new Error(`PromptQL response timeout after ${POLL_TIMEOUT_MS}ms (thread ${threadId})`);
}

export class PromptQLExecutor extends BaseExecutor {
  constructor() {
    super("promptql", { baseUrl: PLAYGROUND_GQL });
  }

  async execute({ body, stream: wantStream, credentials, signal, log }: {
    model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger;
  }) {
    const messages = body?.messages as Array<{ role: string; content: unknown }> | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array"), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    const token = String(credentials.apiKey ?? credentials.accessToken ?? "").trim();
    if (!token) {
      return { response: errorResponse(401, "Missing PromptQL Bearer JWT — paste the Authorization token from prompt.ql.app DevTools (Network → graphql on data.prompt.ql.app). Use the enrich-token JWT, not the DDN/project token."), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }
    if (isJwtExpired(token)) {
      return { response: errorResponse(401, "PromptQL JWT expired — re-paste a fresh Authorization Bearer token from prompt.ql.app."), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    const projectId = (credentials.providerSpecificData?.projectId as string | undefined) || extractProjectIdFromToken(token);
    if (!projectId) {
      return { response: errorResponse(400, "Missing PromptQL projectId — could not derive it from the JWT claims."), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    const prompt = foldHistoryIntoPrompt(messages);
    if (!prompt) {
      return { response: errorResponse(400, "No user message found"), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    const timezone = "UTC";
    log?.info?.("PROMPTQL", `start_thread, project=${projectId}, msgs=${messages.length}`);

    let threadId: string;
    let afterEventId = "0";
    try {
      const data = await gql<{ start_thread: { thread_id: string; thread_events?: ThreadEvent[] } }>(
        token, START_THREAD_ROOMLESS, { message: prompt, projectId, timezone, agentResponseConfig: "force_respond" }, "StartThreadRoomless", signal
      );
      threadId = data.start_thread.thread_id;
      const seed = data.start_thread.thread_events || [];
      if (seed.length) afterEventId = String(seed[seed.length - 1].thread_event_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("PROMPTQL", `start_thread failed: ${msg}`);
      const status = /401|unauthorized|jwt/i.test(msg) ? 401 : 502;
      return { response: errorResponse(status, `PromptQL: ${msg}`), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    let text: string;
    try {
      text = await pollAssistantText(token, threadId, afterEventId, signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("PROMPTQL", `poll failed: ${msg}`);
      const status = /timeout/i.test(msg) ? 504 : 502;
      return { response: errorResponse(status, `PromptQL: ${msg}`), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    if (!text) {
      return { response: errorResponse(502, "PromptQL returned empty content"), url: PLAYGROUND_GQL, headers: {}, transformedBody: body };
    }

    const id = `chatcmpl-pql-${threadId}`;
    const created = Math.floor(Date.now() / 1000);
    const clientModel = "promptql-default";

    if (!wantStream) {
      const promptTokens = Math.max(1, Math.ceil(prompt.length / 4));
      const completionTokens = Math.max(1, Math.ceil(text.length / 4));
      return {
        response: new Response(JSON.stringify({
          id, object: "chat.completion", created, model: clientModel,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        }), { status: 200, headers: { "Content-Type": "application/json", "X-PromptQL-Thread-Id": threadId } }),
        url: PLAYGROUND_GQL, headers: {}, transformedBody: { threadId, projectId },
      };
    }

    const encoder = new TextEncoder();
    const outStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created, model: clientModel,
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created, model: clientModel,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return {
      response: new Response(outStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-PromptQL-Thread-Id": threadId } }),
      url: PLAYGROUND_GQL, headers: {}, transformedBody: { threadId, projectId },
    };
  }
}

export default PromptQLExecutor;
