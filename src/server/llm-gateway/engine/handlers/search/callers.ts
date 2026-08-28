/**
 * Search Provider Request Builders
 *
 * Builds HTTP request `{ url, init }` for 10 search providers.
 */

import { assertPublicUrl } from "@/shared/utils/ssrfGuard";

// ── Types ─────────────────────────────────────────────────────────────

interface SearchProviderConfig {
  id: string;
  baseUrl: string;
  method?: string;
  [key: string]: unknown;
}

interface SearchRequestParams {
  query: string;
  searchType: string;
  maxResults: number;
  token?: string;
  country?: string;
  language?: string;
  timeRange?: string;
  offset?: number;
  domainFilter?: string[];
  contentOptions?: Record<string, unknown>;
  providerOptions?: Record<string, unknown>;
  providerSpecificData?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Split domain filter into includes / excludes (excludes prefixed with "-").
 */
export function parseDomainFilter(domainFilter: string[] | undefined): { includes: string[]; excludes: string[] } {
  if (!domainFilter?.length) return { includes: [], excludes: [] };
  const includes = domainFilter.filter((d: string) => !d.startsWith("-"));
  const excludes = domainFilter.filter((d: string) => d.startsWith("-")).map((d: string) => d.slice(1));
  return { includes, excludes };
}

/**
 * Read string setting from providerOptions first, then providerSpecificData.
 */
export function getProviderSetting(params: SearchRequestParams, key: string): string | undefined {
  const fromOptions = params.providerOptions?.[key];
  if (typeof fromOptions === "string" && fromOptions.trim().length > 0) {
    return fromOptions.trim();
  }
  const fromProviderData = params.providerSpecificData?.[key];
  if (typeof fromProviderData === "string" && fromProviderData.trim().length > 0) {
    return fromProviderData.trim();
  }
  return undefined;
}

/**
 * Resolve base URL with optional override from providerOptions.baseUrl.
 */
export function resolveBaseUrl(config: SearchProviderConfig, params: SearchRequestParams): string {
  const override = getProviderSetting(params, "baseUrl");
  if (override) {
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new Error(`Invalid baseUrl: ${override}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid baseUrl protocol: ${parsed.protocol}`);
    }
    assertPublicUrl(override);
  }
  return (override || config.baseUrl).replace(/\/+$/, "");
}

/**
 * Convert offset+maxResults to 1-indexed page number.
 */
export function toPageNumber(offset: number | undefined, maxResults: number): number | undefined {
  if (typeof offset !== "number" || offset <= 0 || maxResults <= 0) return undefined;
  return Math.floor(offset / maxResults) + 1;
}

// ── Provider Request Builders ───────────────────────────────────────────

function buildSerperRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const endpoint = params.searchType === "news" ? "/news" : "/search";
  const body: Record<string, unknown> = { q: params.query, num: params.maxResults };
  if (params.country) body.gl = params.country.toLowerCase();
  if (params.language) body.hl = params.language;
  return {
    url: `${resolveBaseUrl(config, params)}${endpoint}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": params.token || "" },
      body: JSON.stringify(body),
    },
  };
}

function buildBraveRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const endpoint = params.searchType === "news" ? "/news/search" : "/web/search";
  const qp = new URLSearchParams({ q: params.query, count: String(params.maxResults) });
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("search_lang", params.language);
  return {
    url: `${resolveBaseUrl(config, params)}${endpoint}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": params.token || "" },
    },
  };
}

function buildPerplexityRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = { query: params.query, max_results: params.maxResults };
  if (params.country) body.country = params.country;
  if (params.language) body.search_language_filter = [params.language];
  if (params.domainFilter?.length) body.search_domain_filter = params.domainFilter;
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body),
    },
  };
}

function buildExaRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body: Record<string, unknown> = {
    query: params.query,
    numResults: params.maxResults,
    type: "auto",
    text: true,
    highlights: true,
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.searchType === "news") body.category = "news";
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": params.token || "" },
      body: JSON.stringify(body),
    },
  };
}

function buildTavilyRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.maxResults,
    topic: params.searchType === "news" ? "news" : "general",
  };
  if (includes.length) body.include_domains = includes;
  if (excludes.length) body.exclude_domains = excludes;
  if (params.country) body.country = params.country;
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body),
    },
  };
}

function buildGooglePseRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const apiKey = params.token;
  const cx = getProviderSetting(params, "cx");
  if (!apiKey || !cx) {
    throw new Error("Google Programmable Search requires both apiKey and cx");
  }
  const qp = new URLSearchParams({
    key: apiKey,
    cx,
    q: params.query,
    num: String(Math.min(params.maxResults, 10)),
  });
  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);
  if (params.timeRange && params.timeRange !== "any") {
    const dateRestrictMap: Record<string, string> = { day: "d1", week: "w1", month: "m1", year: "y1" };
    const dateRestrict = dateRestrictMap[params.timeRange];
    if (dateRestrict) qp.set("dateRestrict", dateRestrict);
  }
  if (typeof params.offset === "number" && params.offset > 0) {
    qp.set("start", String(Math.min(params.offset + 1, 91)));
  }
  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildLinkupRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) throw new Error("Linkup Search requires an API key");

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const requestedDepth = getProviderSetting(params, "depth");
  const depth =
    requestedDepth && ["fast", "standard", "deep"].includes(requestedDepth)
      ? requestedDepth
      : "standard";

  const body: Record<string, unknown> = {
    q: params.query,
    depth,
    outputType: "searchResults",
    maxResults: params.maxResults,
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.timeRange && params.timeRange !== "any") {
    const today = new Date();
    const toDate = today.toISOString().slice(0, 10);
    const from = new Date(today);
    if (params.timeRange === "day") from.setUTCDate(from.getUTCDate() - 1);
    if (params.timeRange === "week") from.setUTCDate(from.getUTCDate() - 7);
    if (params.timeRange === "month") from.setUTCMonth(from.getUTCMonth() - 1);
    if (params.timeRange === "year") from.setUTCFullYear(from.getUTCFullYear() - 1);
    body.fromDate = from.toISOString().slice(0, 10);
    body.toDate = toDate;
  }

  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

function buildSearchApiRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) throw new Error("SearchAPI requires an API key");

  const qp = new URLSearchParams({
    engine: params.searchType === "news" ? "google_news" : "google",
    q: params.query,
    api_key: apiKey,
  });
  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);

  const page = toPageNumber(params.offset, params.maxResults);
  if (page) qp.set("page", String(page));

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildYouComRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) throw new Error("You.com Search requires an API key");

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const qp = new URLSearchParams({
    query: params.query,
    count: String(Math.min(params.maxResults, 100)),
  });

  if (params.timeRange && params.timeRange !== "any") qp.set("freshness", params.timeRange);
  if (typeof params.offset === "number" && params.offset > 0 && params.maxResults > 0) {
    qp.set("offset", String(Math.min(Math.floor(params.offset / params.maxResults), 9)));
  }
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("language", params.language);
  if (includes.length) qp.set("include_domains", includes.join(","));
  if (excludes.length) qp.set("exclude_domains", excludes.join(","));

  if (params.contentOptions?.full_page) {
    qp.set("livecrawl", params.searchType === "news" ? "news" : "web");
    qp.append(
      "livecrawl_formats",
      params.contentOptions.format === "markdown" ? "markdown" : "html"
    );
  }

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "X-API-Key": apiKey },
    },
  };
}

function buildSearxngRequest(config: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const baseUrl = resolveBaseUrl(config, params);
  const url = baseUrl.endsWith("/search") ? baseUrl : `${baseUrl}/search`;
  const qp = new URLSearchParams({
    q: params.query,
    format: "json",
    categories: params.searchType === "news" ? "news" : "general",
  });
  if (params.language) qp.set("language", params.language);
  if (params.timeRange && params.timeRange !== "any") qp.set("time_range", params.timeRange);

  const page = toPageNumber(params.offset, params.maxResults);
  if (page) qp.set("pageno", String(page));

  return {
    url: `${url}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

const BUILDERS: Record<string, (config: SearchProviderConfig, params: SearchRequestParams) => { url: string; init: RequestInit }> = {
  "serper": buildSerperRequest,
  "brave-search": buildBraveRequest,
  "perplexity": buildPerplexityRequest,
  "exa": buildExaRequest,
  "tavily": buildTavilyRequest,
  "google-pse": buildGooglePseRequest,
  "linkup": buildLinkupRequest,
  "searchapi": buildSearchApiRequest,
  "youcom": buildYouComRequest,
  "searxng": buildSearxngRequest,
};

/**
 * Dispatch to the correct provider builder by `provider.id`.
 * Falls back to generic POST + bearer auth for unknown providers.
 */
export function buildSearchRequest(provider: SearchProviderConfig, params: SearchRequestParams): { url: string; init: RequestInit } {
  const builder = BUILDERS[provider.id];
  if (builder) return builder(provider, params);

  return {
    url: resolveBaseUrl(provider, params),
    init: {
      method: provider.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults,
        search_type: params.searchType,
      }),
    },
  };
}
