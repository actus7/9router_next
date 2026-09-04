import { EventEmitter } from "events";
import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { toPersistenceError } from "../errors";
import { getUsageStatsForState, type UsageStats } from "./usageAnalytics";

function maskApiKey(key: string | null): string | null {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

const PENDING_TIMEOUT_MS: number = 60 * 1000;
const RING_CAP: number = 50;
const CONN_CACHE_TTL_MS: number = 30 * 1000;
interface PendingRequests {
  byModel: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
}

interface LastErrorProvider {
  provider: string;
  ts: number;
}

interface RecentRing {
  items: RingEntry[];
  initialized: boolean;
}

interface ConnectionMapCache {
  map: Record<string, string>;
  ts: number;
}

interface StatsEmitTimers {
  pending: ReturnType<typeof setTimeout> | null;
  update: ReturnType<typeof setTimeout> | null;
}

interface RingEntry {
  timestamp: string;
  provider: string;
  model: string;
  connectionId?: string;
  apiKey?: string;
  endpoint?: string;
  cost?: number;
  status?: string;
  tokens: Record<string, unknown>;
}

declare global {
  var _pendingRequests: PendingRequests | undefined;
  var _lastErrorProvider: LastErrorProvider | undefined;
  var _statsEmitter: EventEmitter | undefined;
  var _pendingTimers: Record<string, ReturnType<typeof setTimeout>> | undefined;
  var _recentRing: RecentRing | undefined;
  var _connectionMapCache: ConnectionMapCache | undefined;
  var _statsEmitTimers: StatsEmitTimers | undefined;
}

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };

const pendingRequests: PendingRequests = global._pendingRequests!;
const lastErrorProvider: LastErrorProvider = global._lastErrorProvider!;
const pendingTimers: Record<string, ReturnType<typeof setTimeout>> = global._pendingTimers!;
const recentRing: RecentRing = global._recentRing!;
const connCache: ConnectionMapCache = global._connectionMapCache!;
const statsEmitTimers: StatsEmitTimers = global._statsEmitTimers!;

export const statsEmitter: EventEmitter = global._statsEmitter!;

function scheduleStatsEvent(event: string, delayMs: number = 150): void {
  const key: "update" | "pending" = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp?: string): string {
  const d: Date = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface CounterValues {
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  meta?: Record<string, unknown>;
}

interface Counter {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  [key: string]: unknown;
}

function addToCounter(target: Record<string, Counter>, key: string, values: CounterValues): void {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

interface UsageEntry {
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKey?: string;
  endpoint?: string;
  cost?: number;
  status?: string;
  tokens?: Record<string, unknown>;
  /**
   * Durable per-request context. Used for the routing summary: the full trace
   * only rides the response header, and requestDetails is opt-in and pruned, so
   * without this nothing recorded WHY a request routed where it did. Keep it
   * small — usageHistory is never pruned.
   */
  meta?: Record<string, unknown>;
}

interface DayData {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  byProvider: Record<string, Counter>;
  byModel: Record<string, Counter>;
  byAccount: Record<string, Counter>;
  byApiKey: Record<string, Counter>;
  byEndpoint: Record<string, Counter>;
  [key: string]: unknown;
}

function aggregateEntryToDay(day: DayData, entry: UsageEntry): void {
  const promptTokens: number = (entry.tokens?.prompt_tokens as number) || (entry.tokens?.input_tokens as number) || 0;
  const completionTokens: number = (entry.tokens?.completion_tokens as number) || (entry.tokens?.output_tokens as number) || 0;
  const cachedTokens: number = (entry.tokens?.cached_tokens as number) || (entry.tokens?.cache_read_input_tokens as number) || 0;
  const cost: number = entry.cost || 0;
  const vals: CounterValues = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey: string = entry.provider ? `${entry.model}|${entry.provider}` : entry.model!;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal: string = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey: string = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint: string = entry.endpoint || "Unknown";
  const epKey: string = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function pushToRing(entry: UsageEntry): void {
  recentRing.items.push(entry as RingEntry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached(): Promise<Record<string, string>> {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo");
    const all = await getProviderConnections();
    const map: Record<string, string> = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
    return connCache.map;
  } catch (error) {
    throw toPersistenceError("usage.loadConnectionMap", error);
  }
}

async function ensureRingInitialized(): Promise<void> {
  if (recentRing.initialized) return;
  try {
    const db = await getAdapter();
    const rows: Array<Record<string, unknown>> = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r: Record<string, unknown>) => ({
      timestamp: r.timestamp as string, provider: r.provider as string, model: r.model as string, connectionId: r.connectionId as string,
      apiKey: r.apiKey as string, endpoint: r.endpoint as string, cost: r.cost as number, status: r.status as string,
      tokens: parseJson(r.tokens, {}) as Record<string, unknown>,
    }));
    recentRing.initialized = true;
  } catch (error) {
    throw toPersistenceError("usage.initializeRecentRing", error);
  }
}

async function calculateCost(provider: string, model: string, tokens: Record<string, unknown>): Promise<number> {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    const { calculateCostFromTokens } = await import("@/server/llm-gateway/engine/providers/pricing");
    return calculateCostFromTokens(tokens as Record<string, number | undefined>, pricing as Record<string, number | undefined>);
  } catch (error) {
    throw toPersistenceError("usage.calculateCost", error);
  }
}

export function trackPendingRequest(model: string, provider: string, connectionId: string, started: boolean, error: boolean = false): void {
  const modelKey: string = provider ? `${model} (${provider})` : model;
  const timerKey: string = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  scheduleStatsEvent("pending");
}

interface ActiveRequest {
  model: string;
  provider: string;
  account: string;
  count: number;
}

interface RecentRequest {
  timestamp: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  status: string;
}

interface ActiveRequestsResult {
  activeRequests: ActiveRequest[];
  recentRequests: RecentRequest[];
  errorProvider: string;
}

export async function getActiveRequests(): Promise<ActiveRequestsResult> {
  const activeRequests: ActiveRequest[] = [];
  const connectionMap: Record<string, string> = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName: string = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match: RegExpMatchArray | null = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen: Set<string> = new Set();
  const recentRequests: RecentRequest[] = [...recentRing.items]
    .sort((a: RingEntry, b: RingEntry) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((e: RingEntry) => {
      const t: Record<string, unknown> = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: (t.prompt_tokens as number) || (t.input_tokens as number) || 0,
        completionTokens: (t.completion_tokens as number) || (t.output_tokens as number) || 0,
        status: e.status || "ok",
      };
    })
    .filter((e: RecentRequest) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute: string = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key: string = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider: string = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

// Resolving the api key to its row id happens on every usage write, so it must
// not be a query per request. Mirrors getConnectionMapCached below (dynamic
// import + TTL), with one difference that matters: a cache miss forces a
// refresh instead of giving up. A key minted seconds ago has to resolve
// immediately — otherwise its first requests would store the raw secret in
// usageHistory, which has no pruning, and migration 009 has already run.
const KEY_CACHE_TTL_MS: number = 30 * 1000;
const KEY_CACHE_MIN_REFRESH_MS: number = 5 * 1000;
const apiKeyIdCache: { map: Record<string, string>; ts: number } = { map: {}, ts: 0 };

async function refreshApiKeyIdCache(): Promise<void> {
  const { getApiKeys } = await import("./apiKeysRepo");
  const map: Record<string, string> = {};
  for (const k of await getApiKeys()) map[k.key] = k.id;
  apiKeyIdCache.map = map;
  apiKeyIdCache.ts = Date.now();
}

async function resolveApiKeyId(key: string): Promise<string | null> {
  const age = Date.now() - apiKeyIdCache.ts;
  if (age < KEY_CACHE_TTL_MS) {
    const hit = apiKeyIdCache.map[key];
    if (hit) return hit;
    // Unknown key with a warm cache: refresh, but not on every request — a key
    // that is not ours at all would otherwise re-read the table each time.
    if (age < KEY_CACHE_MIN_REFRESH_MS) return null;
  }
  await refreshApiKeyIdCache();
  return apiKeyIdCache.map[key] ?? null;
}

export async function saveRequestUsage(entry: UsageEntry): Promise<void> {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider!, entry.model!, entry.tokens || {});

    // Accounting records WHICH key spent, not the key itself. usageHistory has
    // no pruning, so a raw key stored here outlives every rotation — and it is
    // also embedded in the usageDaily aggregate below, both as a map key and in
    // its meta. Resolving to the row id once here covers both tables. An
    // unrecognised key is kept verbatim: it is not one of ours to resolve, and
    // dropping it would lose the attribution entirely.
    if (entry.apiKey && typeof entry.apiKey === "string") {
      entry.apiKey = (await resolveApiKeyId(entry.apiKey)) ?? entry.apiKey;
    }

    const tokens: Record<string, unknown> = entry.tokens || {};
    const promptTokens: number = (tokens.prompt_tokens as number) || (tokens.input_tokens as number) || 0;
    const completionTokens: number = (tokens.completion_tokens as number) || (tokens.output_tokens as number) || 0;

    let inserted: boolean = false;

    db.transaction(() => {
      const existing = db.get(
        `SELECT id, endpoint FROM usageHistory
         WHERE timestamp = ?
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(model, '') = COALESCE(?, '')
           AND COALESCE(connectionId, '') = COALESCE(?, '')
           AND COALESCE(apiKey, '') = COALESCE(?, '')
           AND promptTokens = ?
           AND completionTokens = ?
         ORDER BY id DESC LIMIT 1`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null,
          promptTokens, completionTokens,
        ]
      ) as { id: number; endpoint: string | null } | undefined;

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
        }
        return;
      }

      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson(entry.meta || {}),
        ]
      );

      const dateKey: string = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]) as { data: string } | undefined;
      const day: DayData = row ? (parseJson(row.data, {}) as DayData) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`) as { value: string } | undefined;
      const next: number = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
      scheduleStatsEvent("update", 250);
    }
  } catch (error) {
    throw toPersistenceError("usage.saveRequest", error);
  }
}

interface UsageHistoryFilter {
  provider?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
}

interface UsageHistoryEntry {
  timestamp: string;
  provider: string;
  model: string;
  connectionId: string;
  apiKeyMasked: string | null;
  endpoint: string;
  cost: number;
  status: string;
  tokens: Record<string, unknown>;
}

export async function getUsageHistory(filter: UsageHistoryFilter = {}): Promise<UsageHistoryEntry[]> {
  const db = await getAdapter();
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where: string = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows: Array<Record<string, unknown>> = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params);

  return rows.map((r: Record<string, unknown>) => ({
    timestamp: r.timestamp as string, provider: r.provider as string, model: r.model as string,
    connectionId: r.connectionId as string, apiKeyMasked: maskApiKey(r.apiKey as string), endpoint: r.endpoint as string,
    cost: r.cost as number, status: r.status as string, tokens: parseJson(r.tokens, {}) as Record<string, unknown>,
  }));
}

export async function getUsageStats(period: string = "all"): Promise<UsageStats> {
  return getUsageStatsForState(period, { pendingRequests, lastErrorProvider });
}

export { getChartData } from "./usageAnalytics";

function formatLogDate(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog(): Promise<void> {}

export async function getRecentLogs(limit: number = 200): Promise<string[]> {
  try {
    const db = await getAdapter();
    const rows: Array<Record<string, unknown>> = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    if (!rows.length) return [];

    const connMap: Record<string, string> = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r: Record<string, unknown>) => {
      const ts: string = formatLogDate(new Date(r.timestamp as string));
      const p: string = (r.provider as string)?.toUpperCase() || "-";
      const m: string = (r.model as string) || "-";
      const account: string = connMap[r.connectionId as string] || (r.connectionId ? (r.connectionId as string).slice(0, 8) : "-");
      const tk: Record<string, unknown> = r.tokens ? (parseJson(r.tokens, {}) as Record<string, unknown>) : {};
      const sent: number | string = (r.promptTokens as number) ?? (tk.prompt_tokens as number) ?? "-";
      const received: number | string = (r.completionTokens as number) ?? (tk.completion_tokens as number) ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (error) {
    throw toPersistenceError("usage.getRecentLogs", error);
  }
}
