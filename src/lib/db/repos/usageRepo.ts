import { EventEmitter } from "events";
import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { toPersistenceError } from "../errors";

function maskApiKey(key: string | null): string | null {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

const PENDING_TIMEOUT_MS: number = 60 * 1000;
const RING_CAP: number = 50;
const CONN_CACHE_TTL_MS: number = 30 * 1000;
const PERIOD_MS: Record<string, number> = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

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

export async function saveRequestUsage(entry: UsageEntry): Promise<void> {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider!, entry.model!, entry.tokens || {});

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
          stringifyJson(tokens), stringifyJson({}),
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

interface DbLike {
  run(sql: string, params?: unknown[]): void;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
}

function loadDaysInRange(adapter: DbLike, maxDays: number | null): Array<{ dateKey: string; data: string }> {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`) as unknown as Array<{ dateKey: string; data: string }>;
  }
  const today: Date = new Date();
  const cutoff: Date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey: string = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]) as unknown as Array<{ dateKey: string; data: string }>;
}

interface UsageStats {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  totalCost: number;
  byProvider: Record<string, Counter>;
  byModel: Record<string, Counter & { rawModel: string; provider: string; lastUsed: string }>;
  byAccount: Record<string, Counter & { rawModel: string; provider: string; connectionId: string; accountName: string; lastUsed: string }>;
  byApiKey: Record<string, Counter & { rawModel: string; provider: string; apiKeyMasked: string | null; keyName: string; apiKeyKey: string; lastUsed: string }>;
  byEndpoint: Record<string, Counter & { endpoint: string; rawModel: string; provider: string; lastUsed: string }>;
  last10Minutes: Array<{ requests: number; promptTokens: number; completionTokens: number; cost: number }>;
  pending: PendingRequests;
  activeRequests: ActiveRequest[];
  recentRequests: RecentRequest[];
  errorProvider: string;
}

interface RefMaps {
  connectionMap: Record<string, string>;
  providerNodeNameMap: Record<string, string>;
  apiKeyMap: Record<string, { name: string | null; id: string; createdAt: string }>;
}

export async function getUsageStats(period: string = "all"): Promise<UsageStats> {
  const db = await getAdapter();
  const maps = await loadReferenceMaps();
  const recentRequests = buildRecentRequests(db);
  const stats = initStats(recentRequests);
  buildActiveRequests(stats, maps.connectionMap);
  buildLast10Minutes(db, stats);

  const useDailySummary: boolean = period !== "24h" && period !== "today";
  if (useDailySummary) {
    aggregateDailySummary(db, period, stats, maps);
  } else {
    aggregateRecentHistory(db, period, stats, maps);
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum: number, p: Counter) => sum + (p.requests || 0), 0);
  return stats;
}

async function loadReferenceMaps(): Promise<RefMaps> {
  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo"),
    import("./apiKeysRepo"),
    import("./nodesRepo"),
  ]);

  const allConnections: Array<{ id: string; name: string | null; email: string | null }> = await getProviderConnections();
  const connectionMap: Record<string, string> = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap: Record<string, string> = {};
  const nodes = await getProviderNodes();
  for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name!;

  const allApiKeys: Array<{ key: string; name: string | null; id: string; createdAt: string }> = await getApiKeys();
  const apiKeyMap: Record<string, { name: string | null; id: string; createdAt: string }> = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  return { connectionMap, providerNodeNameMap, apiKeyMap };
}

function buildRecentRequests(db: DbLike): RecentRequest[] {
  const recentRows: Array<Record<string, unknown>> = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen: Set<string> = new Set();
  return recentRows
    .map((r: Record<string, unknown>) => {
      const t: Record<string, unknown> = (parseJson(r.tokens, {}) || {}) as Record<string, unknown>;
      return {
        timestamp: r.timestamp as string, model: r.model as string, provider: (r.provider as string) || "",
        promptTokens: (t.prompt_tokens as number) || (t.input_tokens as number) || 0,
        completionTokens: (t.completion_tokens as number) || (t.output_tokens as number) || 0,
        cachedTokens: (t.cached_tokens as number) || (t.cache_read_input_tokens as number) || 0,
        status: (r.status as string) || "ok",
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
}

function initStats(recentRequests: RecentRequest[]): UsageStats {
  return {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };
}

function buildActiveRequests(stats: UsageStats, connectionMap: Record<string, string>): void {
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName: string = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match: RegExpMatchArray | null = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }
}

function buildLast10Minutes(db: DbLike, stats: UsageStats): void {
  const now: Date = new Date();
  const currentMinuteStart: Date = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo: Date = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap: Record<number, { requests: number; promptTokens: number; completionTokens: number; cost: number }> = {};
  for (let i = 0; i < 10; i++) {
    const ts: number = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10: Array<Record<string, unknown>> = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt: number = new Date(r.timestamp as string).getTime();
    const minuteStart: number = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += (r.promptTokens as number) || 0;
      bucketMap[minuteStart].completionTokens += (r.completionTokens as number) || 0;
      bucketMap[minuteStart].cost += (r.cost as number) || 0;
    }
  }
}

function aggregateDailySummary(db: DbLike, period: string, stats: UsageStats, maps: RefMaps): void {
  const { connectionMap, providerNodeNameMap, apiKeyMap } = maps;
  const periodDays: Record<string, number> = { "7d": 7, "30d": 30, "60d": 60 };
  const maxDays: number | null = periodDays[period] || null;
  const dayRows: Array<{ dateKey: string; data: string }> = loadDaysInRange(db, maxDays);

  for (const dr of dayRows) {
    const dateKey: string = dr.dateKey;
    const day: DayData = (parseJson(dr.data, {}) || {}) as DayData;
    stats.totalPromptTokens += day.promptTokens || 0;
    stats.totalCompletionTokens += day.completionTokens || 0;
    stats.totalCachedTokens += day.cachedTokens || 0;
    stats.totalCost += day.cost || 0;

    for (const [prov, p] of Object.entries(day.byProvider || {})) {
      if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[prov].requests += p.requests || 0;
      stats.byProvider[prov].promptTokens += p.promptTokens || 0;
      stats.byProvider[prov].completionTokens += p.completionTokens || 0;
      stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
      stats.byProvider[prov].cost += p.cost || 0;
    }

    for (const [mk, m] of Object.entries(day.byModel || {})) {
      const rawModel: string = (m.rawModel as string) || mk.split("|")[0];
      const provider: string = (m.provider as string) || mk.split("|")[1] || "";
      const statsKey: string = provider ? `${rawModel} (${provider})` : rawModel;
      const providerDisplayName: string = providerNodeNameMap[provider] || provider;
      if (!stats.byModel[statsKey]) {
        stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
      }
      stats.byModel[statsKey].requests += m.requests || 0;
      stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
      stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
      stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
      stats.byModel[statsKey].cost += m.cost || 0;
      if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
    }

    for (const [connId, a] of Object.entries(day.byAccount || {})) {
      const accountName: string = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
      const rawModel: string = (a.rawModel as string) || "";
      const provider: string = (a.provider as string) || "";
      const providerDisplayName: string = providerNodeNameMap[provider] || provider;
      const accountKey: string = `${rawModel} (${provider} - ${accountName})`;
      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
      }
      stats.byAccount[accountKey].requests += a.requests || 0;
      stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
      stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
      stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
      stats.byAccount[accountKey].cost += a.cost || 0;
      if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
    }

    for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
      const rawModel: string = (ak.rawModel as string) || "";
      const provider: string = (ak.provider as string) || "";
      const providerDisplayName: string = providerNodeNameMap[provider] || provider;
      const apiKeyVal: string = ak.apiKey as string;
      const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
      const keyName: string = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
      const apiKeyMasked: string | null = maskApiKey(apiKeyVal);
      const apiKeyKey: string = apiKeyMasked || "local-no-key";
      if (!stats.byApiKey[akKey]) {
        stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
      }
      stats.byApiKey[akKey].requests += ak.requests || 0;
      stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
      stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
      stats.byApiKey[akKey].cachedTokens += ak.cachedTokens || 0;
      stats.byApiKey[akKey].cost += ak.cost || 0;
      if (dateKey > (stats.byApiKey[akKey].lastUsed || "")) stats.byApiKey[akKey].lastUsed = dateKey;
    }

    for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
      const endpoint: string = (ep.endpoint as string) || epKey.split("|")[0] || "Unknown";
      const rawModel: string = (ep.rawModel as string) || "";
      const provider: string = (ep.provider as string) || "";
      const providerDisplayName: string = providerNodeNameMap[provider] || provider;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
      }
      stats.byEndpoint[epKey].requests += ep.requests || 0;
      stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
      stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
      stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
      stats.byEndpoint[epKey].cost += ep.cost || 0;
      if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
    }
  }

  const overlayCutoff: number = maxDays ? Date.now() - maxDays * 86400000 : 0;
  const histRows: Array<Record<string, unknown>> = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
    [new Date(overlayCutoff).toISOString()]
  );
  for (const e of histRows) {
    const ts: string = e.timestamp as string;
    const modelKey: string = e.provider ? `${e.model} (${e.provider})` : e.model as string;
    if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;

    if (e.connectionId) {
      const accountName: string = connectionMap[e.connectionId as string] || `Account ${(e.connectionId as string).slice(0, 8)}...`;
      const accountKey: string = `${e.model} (${e.provider} - ${accountName})`;
      if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = ts;
    }

    const apiKeyKey: string = (e.apiKey && typeof e.apiKey === "string")
      ? `${e.apiKey}|${e.model}|${e.provider || "unknown"}`
      : "local-no-key";
    if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = ts;

    const endpoint: string = (e.endpoint as string) || "Unknown";
    const endpointKey: string = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
    if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = ts;
  }
}

function aggregateRecentHistory(db: DbLike, period: string, stats: UsageStats, maps: RefMaps): void {
  const { connectionMap, providerNodeNameMap, apiKeyMap } = maps;
  let cutoff: string;
  if (period === "today") {
    const startOfDay: Date = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    cutoff = startOfDay.toISOString();
  } else {
    cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
  }
  const filtered: Array<Record<string, unknown>> = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
    [cutoff]
  );

  for (const r of filtered) {
    const tokens: Record<string, unknown> = (parseJson(r.tokens, {}) || {}) as Record<string, unknown>;
    const promptTokens: number = (tokens.prompt_tokens as number) || 0;
    const completionTokens: number = (tokens.completion_tokens as number) || 0;
    const cachedTokens: number = (tokens.cached_tokens as number) || (tokens.cache_read_input_tokens as number) || 0;
    const entryCost: number = (r.cost as number) || 0;
    const providerDisplayName: string = providerNodeNameMap[r.provider as string] || (r.provider as string);

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.totalCachedTokens += cachedTokens;
    stats.totalCost += entryCost;

    if (!stats.byProvider[r.provider as string]) stats.byProvider[r.provider as string] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
    stats.byProvider[r.provider as string].requests++;
    stats.byProvider[r.provider as string].promptTokens += promptTokens;
    stats.byProvider[r.provider as string].completionTokens += completionTokens;
    stats.byProvider[r.provider as string].cachedTokens += cachedTokens;
    stats.byProvider[r.provider as string].cost += entryCost;

    const modelKey: string = r.provider ? `${r.model} (${r.provider})` : r.model as string;
    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model as string, provider: providerDisplayName, lastUsed: r.timestamp as string };
    }
    stats.byModel[modelKey].requests++;
    stats.byModel[modelKey].promptTokens += promptTokens;
    stats.byModel[modelKey].completionTokens += completionTokens;
    stats.byModel[modelKey].cachedTokens += cachedTokens;
    stats.byModel[modelKey].cost += entryCost;
    if (new Date(r.timestamp as string) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp as string;

    if (r.connectionId) {
      const accountName: string = connectionMap[r.connectionId as string] || `Account ${(r.connectionId as string).slice(0, 8)}...`;
      const accountKey: string = `${r.model} (${r.provider} - ${accountName})`;
      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model as string, provider: providerDisplayName, connectionId: r.connectionId as string, accountName, lastUsed: r.timestamp as string };
      }
      stats.byAccount[accountKey].requests++;
      stats.byAccount[accountKey].promptTokens += promptTokens;
      stats.byAccount[accountKey].completionTokens += completionTokens;
      stats.byAccount[accountKey].cachedTokens += cachedTokens;
      stats.byAccount[accountKey].cost += entryCost;
      if (new Date(r.timestamp as string) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp as string;
    }

    if (r.apiKey && typeof r.apiKey === "string") {
      const keyInfo = apiKeyMap[r.apiKey];
      const keyName: string = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
      const apiKeyMasked: string | null = maskApiKey(r.apiKey);
      const akKey: string = `${apiKeyMasked}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byApiKey[akKey]) {
        stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model as string, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: apiKeyMasked || "local-no-key", lastUsed: r.timestamp as string };
      }
      const ake = stats.byApiKey[akKey];
      ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
      if (new Date(r.timestamp as string) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp as string;
    } else {
      if (!stats.byApiKey["local-no-key"]) {
        stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model as string, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp as string };
      }
      const ake = stats.byApiKey["local-no-key"];
      ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
      if (new Date(r.timestamp as string) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp as string;
    }

    const endpoint: string = (r.endpoint as string) || "Unknown";
    const epKey: string = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
    if (!stats.byEndpoint[epKey]) {
      stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model as string, provider: providerDisplayName, lastUsed: r.timestamp as string };
    }
    const epe = stats.byEndpoint[epKey];
    epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
    if (new Date(r.timestamp as string) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp as string;
  }
}

interface ChartBucket {
  label: string;
  tokens: number;
  cost: number;
}

export async function getChartData(period: string = "7d"): Promise<ChartBucket[]> {
  const db = await getAdapter();
  const now: number = Date.now();

  if (period === "today") {
    const bucketCount: number = 24;
    const bucketMs: number = 3600000;
    const startOfDay: Date = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime: number = startOfDay.getTime();
    const endTime: number = startTime + bucketCount * bucketMs;
    const labelFn = (ts: number): string => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets: ChartBucket[] = Array.from({ length: bucketCount }, (_, i: number) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows: Array<Record<string, unknown>> = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t: number = new Date(r.timestamp as string).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx: number = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += ((r.promptTokens as number) || 0) + ((r.completionTokens as number) || 0);
        buckets[idx].cost += (r.cost as number) || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount: number = 24;
    const bucketMs: number = 3600000;
    const labelFn = (ts: number): string => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime: number = now - bucketCount * bucketMs;
    const buckets: ChartBucket[] = Array.from({ length: bucketCount }, (_, i: number) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows: Array<Record<string, unknown>> = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t: number = new Date(r.timestamp as string).getTime();
      if (t < startTime || t > now) continue;
      const idx: number = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += ((r.promptTokens as number) || 0) + ((r.completionTokens as number) || 0);
      buckets[idx].cost += (r.cost as number) || 0;
    }
    return buckets;
  }

  const bucketCount: number = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today: Date = new Date();
  const labelFn = (d: Date): string => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const dayRows: Array<{ dateKey: string; data: string }> = loadDaysInRange(db, bucketCount);
  const dayMap: Record<string, DayData> = {};
  for (const r of dayRows) dayMap[r.dateKey] = (parseJson(r.data, {}) || {}) as DayData;

  return Array.from({ length: bucketCount }, (_, i: number) => {
    const d: Date = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey: string = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData: DayData | undefined = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
    };
  });
}

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
