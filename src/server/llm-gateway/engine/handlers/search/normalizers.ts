/**
 * Search Response Normalizers
 *
 * Each normalizer maps a provider-specific response into the unified SearchResult shape.
 */

/** Build a unified SearchResult object. */
function makeResult(providerId: string, item: Record<string, unknown>, idx: number, now: string): Record<string, unknown> {
  const url = (item.url || "") as string;
  return {
    title: item.title || "",
    url,
    display_url: url ? url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0] : undefined,
    snippet: item.snippet || "",
    position: idx + 1,
    score: typeof item.score === "number" ? Math.min(1, Math.max(0, item.score)) : null,
    published_at: item.published_at || null,
    favicon_url: item.favicon_url || null,
    content: item.full_text
      ? { format: item.text_format || "text", text: item.full_text, length: (item.full_text as string).length }
      : null,
    metadata: {
      author: item.author || null,
      language: null,
      source_type: item.source_type || null,
      image_url: item.image_url || null,
    },
    citation: { provider: providerId, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

function normalizeSerper(data: Record<string, unknown>, _query: string, searchType: string) {
  const now = new Date().toISOString();
  const items = searchType === "news" ? data.news : data.organic;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("serper", { title: item.title, url: item.link, snippet: item.snippet || item.description, published_at: item.date }, idx, now)
  );
  const total = (data.searchParameters as Record<string, unknown>)?.totalResults;
  return { results, totalResults: typeof total === "number" ? total : null };
}

function normalizeBrave(data: Record<string, unknown>, _query: string, searchType: string) {
  const now = new Date().toISOString();
  const container = (searchType === "news" ? data.news || data : data.web) as Record<string, unknown>;
  const items = container?.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("brave-search", {
      title: item.title,
      url: item.url,
      snippet: item.description,
      published_at: item.page_age || item.age,
      favicon_url: (item.meta_url as Record<string, unknown>)?.favicon || item.favicon,
    }, idx, now)
  );
  return { results, totalResults: (container?.totalCount as number) ?? null };
}

function normalizePerplexity(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const items = data.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("perplexity", { title: item.title, url: item.url, snippet: item.snippet, published_at: item.date || item.last_updated }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeExa(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const items = data.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("exa", {
      title: item.title,
      url: item.url,
      snippet: (item.highlights as string[])?.[0] || (item.text as string)?.slice(0, 300) || "",
      score: item.score,
      published_at: item.publishedDate,
      favicon_url: item.favicon,
      author: item.author,
      image_url: item.image,
      full_text: item.text,
      text_format: "text",
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeTavily(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const items = data.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("tavily", {
      title: item.title,
      url: item.url,
      snippet: item.content || "",
      score: item.score,
      published_at: item.published_date,
      full_text: item.raw_content,
      text_format: "text",
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeGooglePse(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("google-pse", {
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      image_url: ((item.pagemap as Record<string, unknown>)?.cse_image as Record<string, unknown>[])?.[0]?.src || ((item.pagemap as Record<string, unknown>)?.cse_thumbnail as Record<string, unknown>[])?.[0]?.src || ((item.pagemap as Record<string, unknown>)?.metatags as Record<string, unknown>[])?.[0]?.["og:image"],
    }, idx, now)
  );
  const raw = (data.searchInformation as Record<string, unknown>)?.totalResults ?? ((data.queries as Record<string, unknown>)?.request as Record<string, unknown>[])?.[0]?.totalResults ?? null;
  const total = typeof raw === "string" ? Number(raw) : raw;
  return { results, totalResults: Number.isFinite(total as number) ? (total as number) : null };
}

function normalizeLinkup(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.results) ? data.results : [];
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("linkup", {
      title: item.name || item.title,
      url: item.url,
      snippet: item.content || item.snippet || "",
      source_type: item.type || "web",
      image_url: item.image_url || item.imageUrl || null,
      full_text: item.content,
      text_format: "text",
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeSearchApi(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.organic_results) ? data.organic_results : Array.isArray(data.top_stories) ? data.top_stories : [];
  const results = items.map((item: Record<string, unknown>, idx: number) =>
    makeResult("searchapi", {
      title: item.title,
      url: item.link,
      snippet: item.snippet || item.description || "",
      published_at: item.date || item.published_at,
      favicon_url: item.favicon,
      author: item.source || null,
      image_url: item.thumbnail || null,
    }, idx, now)
  );
  const raw = (data.search_information as Record<string, unknown>)?.total_results;
  const total = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
  return { results, totalResults: Number.isFinite(total as number) ? total : results.length };
}

function normalizeYouCom(data: Record<string, unknown>, _query: string, searchType: string) {
  const now = new Date().toISOString();
  const container = data?.results && typeof data.results === "object" ? data.results as Record<string, unknown> : undefined;
  const section = searchType === "news" ? container?.news || [] : container?.web || [];
  const items = Array.isArray(section) ? section : [];
  const results = items.map((item: Record<string, unknown>, idx: number) => {
    const firstSnippet = Array.isArray(item.snippets) ? (item.snippets as string[]).find((v) => typeof v === "string") : null;
    const livecrawlText = typeof item.markdown === "string" ? item.markdown : typeof item.html === "string" ? item.html : undefined;
    const livecrawlFormat = typeof item.markdown === "string" ? "markdown" : "html";
    return makeResult("youcom", {
      title: item.title,
      url: item.url,
      snippet: typeof firstSnippet === "string" ? firstSnippet : typeof item.description === "string" ? item.description : "",
      published_at: item.page_age,
      favicon_url: item.favicon_url,
      image_url: item.thumbnail_url,
      source_type: searchType,
      full_text: livecrawlText,
      text_format: livecrawlText ? livecrawlFormat : undefined,
    }, idx, now);
  });
  return { results, totalResults: results.length };
}

/** AnySearch wraps its rows in { code, message, data: { results: [...] } }; a non-zero code means failure. */
function normalizeAnysearch(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  if (typeof data.code === "number" && data.code !== 0) return { results: [], totalResults: null };
  const inner = data.data && typeof data.data === "object" && !Array.isArray(data.data)
    ? (data.data as Record<string, unknown>)
    : {};
  const rows = [inner.results, inner.items, data.results, data.items, Array.isArray(data.data) ? data.data : undefined]
    .find((candidate): candidate is unknown[] => Array.isArray(candidate)) || [];
  const results = (rows as Record<string, unknown>[])
    .filter((item) => typeof item?.url === "string" && item.url)
    .map((item, idx) => makeResult("anysearch", {
      title: item.title,
      url: item.url,
      snippet: item.snippet || item.summary || "",
    }, idx, now));
  return { results, totalResults: results.length };
}

// Context7 returns library ids shaped "/owner/repo" rather than URLs. Anything
// else (an absolute URL, a traversal attempt) is dropped instead of being
// turned into a link.
const CONTEXT7_LIBRARY_ID = /^\/[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\/[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/;

/** Context7 returns { results: [{ id: "/owner/repo", title, description }] }. */
function normalizeContext7(data: Record<string, unknown>, _query: string, _searchType: string) {
  const now = new Date().toISOString();
  const rows = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
  const results = rows
    .filter((item) => typeof item?.id === "string" && CONTEXT7_LIBRARY_ID.test(item.id as string))
    .map((item, idx) => makeResult("context7", {
      title: item.title || item.id,
      url: `https://context7.com${item.id}`,
      snippet: item.description || "",
      published_at: item.lastUpdateDate || null,
    }, idx, now));
  return { results, totalResults: results.length };
}

const NORMALIZERS: Record<string, (data: Record<string, unknown>, query: string, searchType: string) => { results: Record<string, unknown>[]; totalResults: number | null }> = {
  "serper": normalizeSerper,
  "brave-search": normalizeBrave,
  "perplexity": normalizePerplexity,
  "exa": normalizeExa,
  "tavily": normalizeTavily,
  "google-pse": normalizeGooglePse,
  "linkup": normalizeLinkup,
  "searchapi": normalizeSearchApi,
  "youcom": normalizeYouCom,
  "anysearch": normalizeAnysearch,
  "context7": normalizeContext7,
};

/**
 * Dispatch to the appropriate normalizer based on providerId.
 * @returns {{results: Array, totalResults: number|null}}
 */
export function normalizeSearchResponse(providerId: string, data: Record<string, unknown>, query: string, searchType: string) {
  const fn = NORMALIZERS[providerId];
  return fn ? fn(data, query, searchType) : { results: [], totalResults: null };
}
