// Web Fetch handler — dispatches to firecrawl, jina-reader, tavily, exa
// Returns normalized shape across all providers

import { safePublicFetch } from "@/server/security/safeFetch";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_FORMAT = "markdown";

interface FetchResult {
  success: boolean;
  status?: number;
  error?: string;
  data?: Record<string, unknown>;
}

interface TryFetchResult {
  ok: boolean;
  res?: Response;
  timeout?: boolean;
  error?: string;
}

/**
 * Fetch with timeout abort.
 */
// Strip non-ASCII chars from header values (HTTP headers must be ByteString).
function sanitizeHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!headers) return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = typeof v === "string" ? v.replace(/[^\x00-\xFF]/g, "").trim() : v;
  }
  return out;
}

async function tryFetch(url: string, init: RequestInit, timeoutMs: number): Promise<TryFetchResult> {
  try {
    const res = await safePublicFetch(url, {
      ...init,
      headers: sanitizeHeaders(init.headers as Record<string, unknown>) as Record<string, string>,
      destinationPolicy: "public-only",
      timeoutMs,
    });
    return { ok: true, res };
  } catch (err: unknown) {
    const isAbort = (err as Error)?.name === "AbortError" || (err as Error)?.name === "TimeoutError";
    return { ok: false, timeout: isAbort, error: (err as Error)?.message || String(err) };
  }
}

function truncate(text: unknown, max: unknown): string {
  if (!text || typeof text !== "string") return (text as string) || "";
  if (!max || (max as number) <= 0) return text;
  return text.length > (max as number) ? text.slice(0, max as number) : text;
}

function parseJinaTitle(text: unknown): string | null {
  const source = String(text || "");
  const metadataTitle = source.match(/^\s*Title:\s*(.+)$/mi);
  if (metadataTitle) return metadataTitle[1].trim();
  const m = source.match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function buildData({ provider, url, title, format, text, costUsd, responseMs, upstreamMs }: { provider: string; url: string; title: string | null; format: string; text: string; costUsd: unknown; responseMs: number; upstreamMs: number }): Record<string, unknown> {
  return {
    provider,
    url,
    title: title || null,
    content: { format, text: text || "", length: (text || "").length },
    metadata: { author: null, published_at: null, language: null },
    usage: { fetch_cost_usd: costUsd ?? null },
    metrics: { response_time_ms: responseMs, upstream_latency_ms: upstreamMs }
  };
}

async function readJsonOrText(res: Response): Promise<{ json?: Record<string, unknown>; text?: string }> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return { json: await res.json() as Record<string, unknown> }; } catch { return { text: "" }; }
  }
  return { text: await res.text() };
}

/**
 * Main handler.
 */
export async function handleFetchCore({ url, format, maxCharacters, provider, providerConfig, credentials, log }: {
  url: string;
  format?: string;
  maxCharacters?: number;
  provider: string;
  providerConfig?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  log?: (...args: unknown[]) => void;
}): Promise<FetchResult> {
  if (!url || typeof url !== "string") {
    return { success: false, status: 400, error: "url is required" };
  }
  if (!provider) {
    return { success: false, status: 400, error: "provider is required" };
  }

  const fmt = format || DEFAULT_FORMAT;
  const timeoutMs = (providerConfig?.timeoutMs as number) || DEFAULT_TIMEOUT_MS;
  const apiKey = (credentials?.apiKey || credentials?.key || credentials?.token || "") as string;
  const costPerQuery = providerConfig?.costPerQuery ?? null;
  const startedAt = Date.now();

  try {
    if (provider === "firecrawl") {
      return await runFirecrawl({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "jina-reader") {
      return await runJina({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "tavily") {
      return await runTavily({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "exa") {
      return await runExa({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    return { success: false, status: 400, error: `Unsupported provider: ${provider}` };
  } catch (err: unknown) {
    log?.("fetch handler error:", (err as Error)?.message || err);
    return { success: false, status: 502, error: (err as Error)?.message || "Internal fetch error" };
  }
}

async function runFirecrawl({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }: { url: string; fmt: string; timeoutMs: number; apiKey: string; maxCharacters?: number; costPerQuery: unknown; startedAt: number }): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ url, formats: [fmt] })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res!);
  if (!r.res!.ok) {
    return { success: false, status: r.res!.status, error: (json as Record<string, unknown>)?.error as string || `Firecrawl error: ${r.res!.status}` };
  }
  const d = ((json as Record<string, unknown>)?.data || {}) as Record<string, unknown>;
  const text = truncate(d.markdown || d.html || d.text || "", maxCharacters);
  const title = ((d.metadata as Record<string, unknown>)?.title as string) || null;
  return {
    success: true,
    data: buildData({
      provider: "firecrawl", url, title, format: fmt, text: text as string,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runJina({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }: { url: string; fmt: string; timeoutMs: number; apiKey: string; maxCharacters?: number; costPerQuery: unknown; startedAt: number }): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://r.jina.ai/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ url })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const body = await r.res!.text();
  if (!r.res!.ok) {
    return { success: false, status: r.res!.status, error: body?.slice(0, 500) || `Jina error: ${r.res!.status}` };
  }
  const text = truncate(body, maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "jina-reader", url, title: parseJinaTitle(body), format: fmt, text: text as string,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runTavily({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }: { url: string; fmt: string; timeoutMs: number; apiKey: string; maxCharacters?: number; costPerQuery: unknown; startedAt: number }): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ urls: [url], extract_depth: "basic" })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res!);
  if (!r.res!.ok) {
    return { success: false, status: r.res!.status, error: (json as Record<string, unknown>)?.error as string || `Tavily error: ${r.res!.status}` };
  }
  const first = (((json as Record<string, unknown>)?.results as Record<string, unknown>[])?.[0] || {}) as Record<string, unknown>;
  const text = truncate(first.raw_content || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "tavily", url, title: null, format: fmt, text: text as string,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runExa({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }: { url: string; fmt: string; timeoutMs: number; apiKey: string; maxCharacters?: number; costPerQuery: unknown; startedAt: number }): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {})
    },
    body: JSON.stringify({ ids: [url], text: true })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res!);
  if (!r.res!.ok) {
    return { success: false, status: r.res!.status, error: (json as Record<string, unknown>)?.error as string || `Exa error: ${r.res!.status}` };
  }
  const first = (((json as Record<string, unknown>)?.results as Record<string, unknown>[])?.[0] || {}) as Record<string, unknown>;
  const text = truncate(first.text || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "exa", url, title: (first.title as string) || null, format: fmt, text: text as string,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}
