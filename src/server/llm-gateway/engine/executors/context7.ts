import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { sseChunk } from "../utils/sse";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";
import type { ExecuteArgs } from "./base";

// Context7 (context7.com) is a library-docs SEARCH API, not a chat-completions
// endpoint: GET {baseUrl}/search?query=<q> → { results: [{ id: "/owner/repo",
// title, description, lastUpdateDate }] }. Key optional (anonymous tier is
// rate-limited, not metered; a configured ctx7sk-* key rides as Bearer).
// Ported from the upstream reference (diegosouzapw/OmniRoute,
// open-sse/handlers/search.ts buildContext7Request/normalizeContext7Response) —
// there is no real "chat" endpoint to wrap, so this executor treats the last
// user message as a search query and formats the results as an assistant reply.
const CONTEXT7_BASE = (PROVIDERS["context7"]?.baseUrl as string) || "https://context7.com/api/v1";

interface Context7SearchItem {
  id?: string;
  title?: string;
  description?: string;
  lastUpdateDate?: string;
}

// Canonical Context7 library-id shape ("/owner/repo") — guards against an
// upstream response embedding an off-site or path-traversal id.
function isValidContext7LibraryId(id: string): boolean {
  if (typeof id !== "string") return false;
  const seg = /^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/;
  const m = /^\/(.+)\/(.+)$/.exec(id);
  return m !== null && seg.test(m[1]) && seg.test(m[2]);
}

function extractQuery(body: Record<string, unknown>): string {
  const messages = body?.messages as Record<string, unknown>[] | undefined;
  const lastUser = [...(messages || [])].reverse().find((m) => m.role === "user");
  const content = lastUser?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c: Record<string, unknown>) => (typeof c.text === "string" ? c.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function formatResults(items: Context7SearchItem[]): string {
  const usable = items.filter((item) => isValidContext7LibraryId(item?.id || ""));
  if (usable.length === 0) return "No matching libraries found on Context7.";
  return usable
    .slice(0, 10)
    .map((item, i) => {
      const lines = [`${i + 1}. ${item.title || item.id}`, `   https://context7.com${item.id}`];
      if (item.description) lines.splice(1, 0, `   ${item.description}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export class Context7Executor extends BaseExecutor {
  constructor() {
    super("context7", PROVIDERS["context7"]);
  }

  buildHeaders(credentials: Credentials): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = credentials?.apiKey || credentials?.accessToken;
    // "public" is a synthetic placeholder injected for noAuth providers with no
    // connection — never a real key. Sending it upstream gets rejected as an
    // invalid API key even though Context7's anonymous tier works with no
    // Authorization header at all.
    if (token && token !== "public") headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  private errorResult(headers: Record<string, string>, body: Record<string, unknown>, status: number, message: string) {
    return {
      response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      url: `${CONTEXT7_BASE}/search`,
      headers,
      transformedBody: body,
    };
  }

  async execute({ model, body, stream, credentials, signal, log }: ExecuteArgs) {
    const headers = this.buildHeaders(credentials);
    const query = extractQuery(body);

    if (!query) {
      return this.errorResult(headers, body, 400, "Context7 needs a user message to search for (library name or topic).");
    }

    try {
      const qp = new URLSearchParams({ query });
      const res = await fetch(`${CONTEXT7_BASE}/search?${qp}`, { method: "GET", headers, signal });
      if (!res.ok) {
        const text = await res.text();
        return this.errorResult(headers, body, res.status, `Context7 search failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as { results?: Context7SearchItem[] };
      const content = formatResults(data?.results || []);
      const cid = `chatcmpl-ctx7-${crypto.randomUUID().slice(0, 12)}`;
      const created = Math.floor(Date.now() / 1000);

      if (stream) {
        const encoder = new TextEncoder();
        const body_ = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null, logprobs: null }],
            })));
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          },
        });
        return {
          response: new Response(body_, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
          url: `${CONTEXT7_BASE}/search`,
          headers,
          transformedBody: body,
        };
      }

      const payload = JSON.stringify({
        id: cid,
        object: "chat.completion",
        created,
        model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
      return {
        response: new Response(payload, { status: 200, headers: { "Content-Type": "application/json" } }),
        url: `${CONTEXT7_BASE}/search`,
        headers,
        transformedBody: body,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      (log as Logger | undefined)?.error?.("CONTEXT7", `Executor error: ${msg}`);
      return this.errorResult(headers, body, 502, msg);
    }
  }
}

export default Context7Executor;
