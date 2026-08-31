// Poe (poe.com) GraphQL executor.
//
// poe.com/api/gql_POST answers with a single non-streaming JSON body — not
// SSE. The previous version of this executor parsed the upstream response as
// `data:` SSE lines, which never matched anything against a plain JSON
// response, so every conversation silently came back empty. It also called a
// `messageCreate` mutation; the query poe.com's own frontend actually uses is
// `chatWithBot`. Ported from OmniRoute's poe-web.ts — this executor now makes
// one JSON request and synthesizes the streaming/non-streaming shape
// client-side.
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

const POE_API = PROVIDERS["poe-web"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const MODEL_TO_POE_BOT: Record<string, string> = {
  "GPT-5.2": "GPT-5.2",
  "Claude-Opus-4.8": "Claude-Opus-4.8",
  "Gemini-3.0-Pro": "Gemini-3.0-Pro",
};

function parseOpenAIMessages(messages: Record<string, unknown>[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c: Record<string, unknown>) => c.type === "text")
        .map((c: Record<string, unknown>) => String(c.text || ""))
        .join(" ");
    }
    if (!content.trim()) continue;
    if (role === "system") {
      parts.push(`[System]: ${content}`);
    } else {
      parts.push(content);
    }
  }
  return parts.join("\n\n");
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), { status, headers: { "Content-Type": "application/json" } });
}

function extractPbCookie(raw: string): string {
  const match = raw.match(/p-b=([^;]+)/);
  return match ? match[1] : raw;
}

export class PoeWebExecutor extends BaseExecutor {
  constructor() {
    super("poe-web", PROVIDERS["poe-web"]);
  }

  async execute({ model, body, stream: wantStream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array"), url: POE_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const poeBot = MODEL_TO_POE_BOT[model] || model || MODEL_TO_POE_BOT["GPT-5.2"];
    const query = parseOpenAIMessages(messages);
    if (!query.trim()) {
      return { response: errorResponse(400, "Empty query after processing"), url: POE_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const graphqlQuery = `query ChatViewQuery($bot: String!, $query: String!) {
      chatWithBot(bot: $bot, query: $query) {
        messageId
        text
        state
      }
    }`;

    const poePayload = { operationName: "ChatViewQuery", query: graphqlQuery, variables: { bot: poeBot, query } };

    const pbCookie = extractPbCookie(String(credentials.apiKey ?? "").trim());
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Referer: "https://www.poe.com/",
      Origin: "https://www.poe.com",
      Cookie: `p-b=${pbCookie}`,
    };

    log?.info?.("POE-WEB", `Query to ${model} (bot=${poeBot}), len=${query.length}`);

    let response: Response;
    try {
      response = await fetch(POE_API, { method: "POST", headers, body: JSON.stringify(poePayload), signal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("POE-WEB", `Fetch failed: ${errMsg}`);
      return { response: errorResponse(502, `Poe connection failed: ${errMsg}`), url: POE_API, headers, transformedBody: poePayload };
    }

    if (!response.ok) {
      const status = response.status;
      const errText = await response.text().catch(() => "");
      let errMsg = errText || `Poe returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Poe auth failed — p-b cookie may be expired. Re-paste your p-b cookie from poe.com.";
      else if (status === 429) errMsg = "Poe rate limited. Wait a moment and retry.";
      log?.warn?.("POE-WEB", errMsg);
      return { response: errorResponse(status, errMsg), url: POE_API, headers, transformedBody: poePayload };
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const inner = (data.data ?? {}) as Record<string, unknown>;
    const chatData = (inner.chatWithBot ?? {}) as Record<string, unknown>;
    const text = (chatData.text as string) || "";
    if (!text && Array.isArray(data.errors) && data.errors.length > 0) {
      const gqlErr = (data.errors[0] as Record<string, unknown>)?.message;
      return { response: errorResponse(502, `Poe error: ${typeof gqlErr === "string" ? gqlErr : "GraphQL error"}`), url: POE_API, headers, transformedBody: poePayload };
    }

    const cid = `chatcmpl-poe-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (!wantStream) {
      const promptTokens = Math.ceil(query.length / 4);
      const completionTokens = Math.ceil(text.length / 4);
      return {
        response: new Response(JSON.stringify({
          id: cid, object: "chat.completion", created, model, system_fingerprint: null,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
        url: POE_API, headers, transformedBody: poePayload,
      };
    }

    // Poe's GraphQL response is a single JSON blob, not incremental — emit it
    // as one streaming chunk so streaming clients still get a valid SSE shape.
    const encoder = new TextEncoder();
    const outStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null, logprobs: null }],
        })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return {
      response: new Response(outStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
      url: POE_API, headers, transformedBody: poePayload,
    };
  }
}

export default PoeWebExecutor;
