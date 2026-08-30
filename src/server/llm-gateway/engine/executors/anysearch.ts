import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { sseChunk } from "../utils/sse";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";
import type { ExecuteArgs } from "./base";

// AnySearch (api.anysearch.com) is a web-search API, not a chat-completions
// endpoint: POST {baseUrl} { query, max_results } → envelope
// { code: 0, message: "success", data: { results: [{ title, url, snippet }] } },
// non-zero code = error. Key optional. Ported from the upstream reference
// (diegosouzapw/OmniRoute, open-sse/handlers/search/anysearchSearch.ts) — there
// is no real "chat" endpoint to wrap, so this executor treats the last user
// message as a search query and formats the results as an assistant reply.
const ANYSEARCH_URL = (PROVIDERS["anysearch"]?.baseUrl as string) || "https://api.anysearch.com/v1/search";
const MAX_RESULTS = 5;

interface AnysearchItem {
  title?: string;
  url?: string;
  snippet?: string;
  summary?: string;
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

function extractItems(data: Record<string, unknown>): AnysearchItem[] {
  const inner = (data?.data && typeof data.data === "object" && !Array.isArray(data.data)) ? data.data as Record<string, unknown> : {};
  const candidates: unknown[] = [inner.results, data?.results, inner.items, data?.items, Array.isArray(data?.data) ? data.data : undefined];
  const rows = candidates.find((c): c is unknown[] => Array.isArray(c)) || [];
  return rows.filter((r): r is AnysearchItem => !!(r as AnysearchItem)?.url);
}

function formatResults(items: AnysearchItem[]): string {
  if (items.length === 0) return "No results found via AnySearch.";
  return items
    .slice(0, MAX_RESULTS)
    .map((item, i) => {
      const lines = [`${i + 1}. ${item.title || item.url}`, `   ${item.url}`];
      const snippet = item.snippet || item.summary;
      if (snippet) lines.splice(1, 0, `   ${snippet}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export class AnySearchExecutor extends BaseExecutor {
  constructor() {
    super("anysearch", PROVIDERS["anysearch"]);
  }

  buildHeaders(credentials: Credentials): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    const token = credentials?.apiKey || credentials?.accessToken;
    // "public" is a synthetic placeholder for noAuth providers with no connection — never a real key.
    if (token && token !== "public") headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  private errorResult(headers: Record<string, string>, body: Record<string, unknown>, status: number, message: string) {
    return {
      response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      url: ANYSEARCH_URL,
      headers,
      transformedBody: body,
    };
  }

  async execute({ model, body, stream, credentials, signal, log }: ExecuteArgs) {
    const headers = this.buildHeaders(credentials);
    const query = extractQuery(body);

    if (!query) {
      return this.errorResult(headers, body, 400, "AnySearch needs a user message to search for.");
    }

    try {
      const res = await fetch(ANYSEARCH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, max_results: MAX_RESULTS }),
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || (typeof data.code === "number" && data.code !== 0)) {
        const message = (data.message as string) || (data.error as string) || `HTTP ${res.status}`;
        return this.errorResult(headers, body, res.ok ? 502 : res.status, `AnySearch search failed: ${message}`);
      }

      const content = formatResults(extractItems(data));
      const cid = `chatcmpl-anysearch-${crypto.randomUUID().slice(0, 12)}`;
      const created = Math.floor(Date.now() / 1000);

      if (stream) {
        const encoder = new TextEncoder();
        const streamBody = new ReadableStream({
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
          response: new Response(streamBody, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } }),
          url: ANYSEARCH_URL,
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
        url: ANYSEARCH_URL,
        headers,
        transformedBody: body,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      (log as Logger | undefined)?.error?.("ANYSEARCH", `Executor error: ${msg}`);
      return this.errorResult(headers, body, 502, msg);
    }
  }
}

export default AnySearchExecutor;
