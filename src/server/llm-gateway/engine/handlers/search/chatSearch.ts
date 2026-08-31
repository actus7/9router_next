/**
 * Wrap chat-completions endpoints (with built-in web search) into the unified
 * /v1/search response format. Supports gemini, openai, xai, kimi, minimax, perplexity.
 */
import { PROVIDER_MEDIA } from "../../providers/index";

// Default search model + endpoint derive from registry searchViaChat (single source)
const searchModel = (id: string): string | undefined => (PROVIDER_MEDIA[id]?.searchViaChat as Record<string, unknown>)?.defaultModel as string | undefined;
const searchEndpoint = (id: string, model?: string): string =>
  (((PROVIDER_MEDIA[id]?.searchViaChat as Record<string, unknown>)?.endpoint as string) || "").replace("{model}", model || "");

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 10;

interface Citation { url: string; title?: string; snippet?: string }
interface SearchResult { title: string; url: string; snippet: string; position: number; score: null; published_at: null; favicon_url: null; content: null; metadata: Record<string, unknown>; citation: { provider: string; retrieved_at: string; rank: number }; provider_raw: null }

/**
 * Normalize a citation entry into the unified result shape.
 */
function toResult(c: Citation, index: number, provider: string, retrievedAt: string): SearchResult {
  return {
    title: c.title || "",
    url: c.url,
    snippet: c.snippet || "",
    position: index + 1,
    score: null,
    published_at: null,
    favicon_url: null,
    content: null,
    metadata: {},
    citation: { provider, retrieved_at: retrievedAt, rank: index + 1 },
    provider_raw: null
  };
}

/** Coerce a citation that might be a raw URL string or an object. */
function normalizeCitation(c: unknown): Citation | null {
  if (!c) return null;
  if (typeof c === "string") return { url: c };
  if (typeof c === "object" && (c as Record<string, unknown>).url) return c as Citation;
  return null;
}

interface ChatSearchConfig {
  endpoint: (model?: string) => string;
  buildBody: (query: string, model: string) => Record<string, unknown>;
  buildHeaders: (token: string) => Record<string, string>;
  extractAnswer: (data: Record<string, unknown>) => { text: string; citations: Citation[]; tokens: number };
}

/**
 * Provider-specific configuration map.
 */
const CHAT_SEARCH_CONFIG: Record<string, ChatSearchConfig> = {
  gemini: {
    endpoint: (model?: string) => searchEndpoint("gemini", model),
    buildBody: (query: string) => ({
      contents: [{ role: "user", parts: [{ text: query }] }],
      tools: [{ google_search: {} }]
    }),
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      "x-goog-api-key": token
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
      const candidate = candidates?.[0];
      const parts = ((candidate?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>) || [];
      const text = parts.map((p) => (p?.text as string) || "").filter(Boolean).join("");
      const chunks = ((candidate?.groundingMetadata as Record<string, unknown>)?.groundingChunks as Array<Record<string, unknown>>) || [];
      const citations = chunks
        .map((ch) => ch?.web as Record<string, unknown>)
        .filter(Boolean)
        .map((w) => ({ url: (w.uri || w.url) as string, title: (w.title || "") as string }))
        .filter((c) => c.url);
      const tokens = ((data?.usageMetadata as Record<string, unknown>)?.totalTokenCount as number) || 0;
      return { text, citations, tokens };
    }
  },

  openai: {
    endpoint: () => searchEndpoint("openai"),
    buildBody: (query: string, model: string) => {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: query }]
      };
      if (!/search/i.test(model)) {
        body.tools = [{ type: "web_search" }];
      }
      return body;
    },
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const choices = data?.choices as Array<Record<string, unknown>> | undefined;
      const msg = (choices?.[0]?.message as Record<string, unknown>) || {};
      const text = (msg.content as string) || "";
      const annotations = Array.isArray(msg.annotations) ? msg.annotations as Array<Record<string, unknown>> : [];
      const fromAnn = annotations
        .map((a) => a?.url_citation as Record<string, unknown>)
        .filter(Boolean)
        .map((u) => ({ url: u.url as string, title: (u.title || "") as string }));
      const fromTop = Array.isArray(data?.citations)
        ? (data.citations as unknown[]).map(normalizeCitation).filter(Boolean) as Citation[]
        : [];
      const citations = fromAnn.length ? fromAnn : fromTop;
      const tokens = ((data?.usage as Record<string, unknown>)?.total_tokens as number) || 0;
      return { text, citations, tokens };
    }
  },

  xai: {
    endpoint: () => searchEndpoint("xai"),
    buildBody: (query: string, model: string) => ({
      model,
      input: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }]
    }),
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const output = Array.isArray(data?.output) ? data.output as Array<Record<string, unknown>> : [];
      let text = "";
      const citations: Citation[] = [];
      for (const item of output) {
        const parts = Array.isArray(item?.content) ? item.content as Array<Record<string, unknown>> : [];
        for (const p of parts) {
          if (typeof p?.text === "string") text += p.text;
          const anns = Array.isArray(p?.annotations) ? p.annotations as Array<Record<string, unknown>> : [];
          for (const a of anns) {
            const c = normalizeCitation(a?.url ? a : a?.url_citation);
            if (c) citations.push(c);
          }
        }
      }
      if (!citations.length && Array.isArray(data?.citations)) {
        for (const c of data.citations as unknown[]) {
          const n = normalizeCitation(c);
          if (n) citations.push(n);
        }
      }
      const tokens = ((data?.usage as Record<string, unknown>)?.total_tokens as number) || 0;
      return { text, citations, tokens };
    }
  },

  kimi: {
    endpoint: () => searchEndpoint("kimi"),
    buildBody: (query: string, model: string) => ({
      model,
      messages: [{ role: "user", content: query }],
      tools: [
        { type: "builtin_function", function: { name: "$web_search" } }
      ]
    }),
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const choices = data?.choices as Array<Record<string, unknown>> | undefined;
      const msg = (choices?.[0]?.message as Record<string, unknown>) || {};
      const text = (msg.content as string) || "";
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls as Array<Record<string, unknown>> : [];
      const citations: Citation[] = [];
      for (const call of calls) {
        const fn = call?.function as Record<string, unknown>;
        const argStr = fn?.arguments as string;
        if (!argStr) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
        } catch {
          continue;
        }
        const items =
          (parsed?.search_results as unknown[]) ||
          (parsed?.results as unknown[]) ||
          (parsed?.references as unknown[]) ||
          [];
        if (Array.isArray(items)) {
          for (const it of items) {
            const itObj = it as Record<string, unknown>;
            const url = (itObj?.url || itObj?.link) as string;
            if (!url) continue;
            citations.push({
              url,
              title: (itObj.title as string) || "",
              snippet: (itObj.snippet as string) || (itObj.summary as string) || ""
            });
          }
        }
      }
      const tokens = ((data?.usage as Record<string, unknown>)?.total_tokens as number) || 0;
      return { text, citations, tokens };
    }
  },

  minimax: {
    endpoint: () => searchEndpoint("minimax"),
    buildBody: (query: string, model: string) => ({
      model,
      messages: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }]
    }),
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const choices = data?.choices as Array<Record<string, unknown>> | undefined;
      const msg = (choices?.[0]?.message as Record<string, unknown>) || {};
      const text = (msg.content as string) || "";
      const citations: Citation[] = [];
      const direct = Array.isArray(data?.web_search_results)
        ? data.web_search_results as Array<Record<string, unknown>>
        : [];
      for (const it of direct) {
        const url = (it?.url || it?.link) as string;
        if (url) {
          citations.push({
            url,
            title: (it.title as string) || "",
            snippet: (it.snippet as string) || (it.summary as string) || ""
          });
        }
      }
      if (!citations.length) {
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls as Array<Record<string, unknown>> : [];
        for (const call of calls) {
          const fn = call?.function as Record<string, unknown>;
          const argStr = fn?.arguments as string;
          if (!argStr) continue;
          let parsed: Record<string, unknown>;
          try {
            parsed = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
          } catch {
            continue;
          }
          const items = (parsed?.results as unknown[]) || (parsed?.search_results as unknown[]) || [];
          if (Array.isArray(items)) {
            for (const it of items) {
              const itObj = it as Record<string, unknown>;
              const url = (itObj?.url || itObj?.link) as string;
              if (!url) continue;
              citations.push({
                url,
                title: (itObj.title as string) || "",
                snippet: (itObj.snippet as string) || ""
              });
            }
          }
        }
      }
      const tokens = ((data?.usage as Record<string, unknown>)?.total_tokens as number) || 0;
      return { text, citations, tokens };
    }
  },

  perplexity: {
    endpoint: () => searchEndpoint("perplexity"),
    buildBody: (query: string, model: string) => ({
      model,
      messages: [{ role: "user", content: query }]
    }),
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const choices = data?.choices as Array<Record<string, unknown>> | undefined;
      const msg = (choices?.[0]?.message as Record<string, unknown>) || {};
      const text = (msg.content as string) || "";
      const raw = data?.citations || [];
      const citations = Array.isArray(raw)
        ? (raw as unknown[]).map(normalizeCitation).filter(Boolean) as Citation[]
        : [];
      const tokens = ((data?.usage as Record<string, unknown>)?.total_tokens as number) || 0;
      return { text, citations, tokens };
    }
  },

  "perplexity-agent": {
    endpoint: () => searchEndpoint("perplexity-agent"),
    buildBody: (query: string, model: string) => ({
      model,
      input: query,
      tools: [{ type: "web_search" }]
    }),
    buildHeaders: (token: string) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }),
    extractAnswer: (data: Record<string, unknown>) => {
      const output = Array.isArray(data?.output) ? data.output as Array<Record<string, unknown>> : [];
      let text = "";
      const citations: Citation[] = [];
      for (const item of output) {
        const parts = Array.isArray(item?.content) ? item.content as Array<Record<string, unknown>> : [];
        for (const p of parts) {
          if (typeof p?.text === "string") text += p.text;
          const anns = Array.isArray(p?.annotations) ? p.annotations as Array<Record<string, unknown>> : [];
          for (const a of anns) {
            const c = normalizeCitation(a?.url ? a : a?.url_citation);
            if (c) citations.push(c);
          }
        }
        const results = Array.isArray(item?.results) ? item.results as Array<Record<string, unknown>> : [];
        for (const r of results) {
          const url = (r?.url || r?.link) as string;
          if (!url) continue;
          citations.push({
            url,
            title: (r?.title as string) || "",
            snippet: (r?.snippet as string) || ""
          });
        }
      }
      if (!citations.length && Array.isArray(data?.citations)) {
        for (const c of data.citations as unknown[]) {
          const n = normalizeCitation(c);
          if (n) citations.push(n);
        }
      }
      const tokens = ((data?.usage as Record<string, unknown>)?.total_tokens as number) || 0;
      return { text, citations, tokens };
    }
  }
};

/**
 * Execute a chat-search request against the chosen provider.
 */
export async function handleChatSearch({
  provider,
  query,
  maxResults,
  model,
  credentials,
  log
}: {
  provider: string;
  query: string;
  maxResults?: number;
  model?: string;
  credentials: Record<string, unknown>;
  log?: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
}) {
  const startTime = Date.now();
  const cfg = CHAT_SEARCH_CONFIG[provider];

  if (!cfg) {
    return {
      success: false,
      status: 400,
      error: `Unsupported chat-search provider: ${provider}`
    };
  }

  if (!query || typeof query !== "string") {
    return { success: false, status: 400, error: "Missing query" };
  }

  const token = (credentials?.apiKey || credentials?.accessToken) as string | undefined;
  if (!token) {
    return {
      success: false,
      status: 401,
      error: "Missing credentials (apiKey or accessToken)"
    };
  }

  const limit =
    Number.isFinite(maxResults) && (maxResults as number) > 0
      ? Math.floor(maxResults as number)
      : DEFAULT_MAX_RESULTS;
  const useModel = model || searchModel(provider);
  const url = cfg.endpoint(useModel);
  const body = cfg.buildBody(query, useModel || "");
  const headers = cfg.buildHeaders(token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const upstreamStart = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if ((err as Error)?.name === "AbortError") {
      log?.warn?.(`[chatSearch] timeout provider=${provider}`);
      return { success: false, status: 504, error: "Upstream timeout" };
    }
    log?.error?.(`[chatSearch] network error provider=${provider}: ${(err as Error)?.message}`);
    return {
      success: false,
      status: 502,
      error: `Network error: ${(err as Error)?.message || "unknown"}`
    };
  }
  clearTimeout(timer);
  const upstreamLatency = Date.now() - upstreamStart;

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return {
      success: false,
      status: 502,
      error: `Invalid upstream response (status ${resp.status})`
    };
  }

  if (!resp.ok) {
    const errMsg =
      ((data?.error as Record<string, unknown>)?.message as string) ||
      data?.error ||
      data?.message ||
      `Upstream HTTP ${resp.status}`;
    log?.warn?.(`[chatSearch] upstream error provider=${provider} status=${resp.status}`);
    return {
      success: false,
      status: resp.status,
      error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)
    };
  }

  const { text, citations, tokens } = cfg.extractAnswer(data);
  const retrievedAt = new Date().toISOString();
  const limited = (citations || []).slice(0, limit);
  const results = limited.map((c: Citation, i: number) => toResult(c, i, provider, retrievedAt));

  return {
    success: true,
    status: 200,
    data: {
      provider,
      query,
      results,
      answer: { source: provider, text: text || "", model: useModel },
      usage: { queries_used: 1, search_cost_usd: 0, llm_tokens: tokens || 0 },
      metrics: {
        response_time_ms: Date.now() - startTime,
        upstream_latency_ms: upstreamLatency,
        total_results_available: null
      },
      errors: []
    }
  };
}

