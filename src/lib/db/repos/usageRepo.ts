import { EventEmitter } from "events";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { resolveApiKeyId } from "./apiKeyIdCache";
import { bumpTenantMeta } from "../helpers/tenantMeta";
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


interface ConnectionMapCache {
  map: Record<string, string>;
  ts: number;
}

/**
 * Debounce timers for the stats SSE, keyed by account.
 *
 * They used to be one pair for the whole process, which coalesced across
 * accounts: while account A's 150ms window was open, a write by account B
 * scheduled nothing, so B's dashboard simply missed the update.
 */
type StatsEmitTimers = Map<string, {
  pending: ReturnType<typeof setTimeout> | null;
  update: ReturnType<typeof setTimeout> | null;
}>;

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

/**
 * In-flight counters, the last failing provider and the connection-name cache,
 * per account.
 *
 * These were four module-level singletons. Under one operator that was just
 * process state; with accounts, a shared `pendingRequests` puts one tenant's
 * live traffic on another tenant's dashboard, and a shared connection-name
 * cache hands out the names of accounts the viewer cannot see. None of it
 * reaches the database, so no query filter would have caught it.
 */
interface TenantRuntime {
  pendingRequests: PendingRequests;
  lastErrorProvider: LastErrorProvider;
  pendingTimers: Record<string, ReturnType<typeof setTimeout>>;
  connCache: ConnectionMapCache;
}

declare global {
  var _statsEmitter: EventEmitter | undefined;
  var _usageRuntime: Map<string, TenantRuntime> | undefined;
  var _statsEmitTimers: StatsEmitTimers | undefined;
}

// In-memory state shared across Next.js modules
if (!global._usageRuntime) global._usageRuntime = new Map();
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._statsEmitTimers) global._statsEmitTimers = new Map();

const runtimes: Map<string, TenantRuntime> = global._usageRuntime!;
const statsEmitTimers: StatsEmitTimers = global._statsEmitTimers!;

function runtime(): TenantRuntime {
  const tenantId: string = currentTenantId();
  let state: TenantRuntime | undefined = runtimes.get(tenantId);
  if (!state) {
    state = {
      pendingRequests: { byModel: {}, byAccount: {} },
      lastErrorProvider: { provider: "", ts: 0 },
      pendingTimers: {},
      connCache: { map: {}, ts: 0 },
    };
    runtimes.set(tenantId, state);
  }
  return state;
}

export const statsEmitter: EventEmitter = global._statsEmitter!;

/**
 * Wakes only the SSE streams belonging to the account that wrote.
 *
 * The event name carries the account. It has to: the listener runs inside the
 * `setTimeout` scheduled here, so it inherits *this* request's tenant context —
 * a process-wide `emit("update")` therefore ran every other account's listener
 * under this account's tenant, and `getUsageStats()` shipped one account's
 * models, connections, masked keys and costs to every open dashboard.
 */
export function statsEventName(event: "update" | "pending", tenantId: string): string {
  return `${event}:${tenantId}`;
}

function scheduleStatsEvent(event: string, delayMs: number = 150): void {
  const key: "update" | "pending" = event === "update" ? "update" : "pending";
  const tenantId: string = currentTenantId();
  let timers = statsEmitTimers.get(tenantId);
  if (!timers) {
    timers = { pending: null, update: null };
    statsEmitTimers.set(tenantId, timers);
  }
  if (timers[key]) return;
  timers[key] = setTimeout(() => {
    timers[key] = null;
    statsEmitter.emit(statsEventName(key, tenantId));
  }, delayMs);
  timers[key]?.unref?.();
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

async function getConnectionMapCached(): Promise<Record<string, string>> {
  const connCache: ConnectionMapCache = runtime().connCache;
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

/**
 * The last `RING_CAP` requests for the current account.
 *
 * This used to be a process-wide ring buffer topped up on every write. Making
 * it per-tenant would have meant one buffer per account held forever in a
 * process that may serve thousands; the query it replaces is 50 rows off
 * `idx_uh_ts`, which the same dashboard poll already pays for several times.
 */
async function loadRecentRing(): Promise<RingEntry[]> {
  try {
    const db = await getAdapter();
    const rows: Array<Record<string, unknown>> = await db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens
       FROM usageHistory WHERE userId = ? ORDER BY id DESC LIMIT ?`,
      [currentTenantId(), RING_CAP],
    );
    return rows.map((r: Record<string, unknown>) => ({
      timestamp: r.timestamp as string, provider: r.provider as string, model: r.model as string, connectionId: r.connectionId as string,
      apiKey: r.apiKey as string, endpoint: r.endpoint as string, cost: r.cost as number, status: r.status as string,
      tokens: parseJson(r.tokens, {}) as Record<string, unknown>,
    }));
  } catch (error) {
    throw toPersistenceError("usage.loadRecentRequests", error);
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
  const { pendingRequests, pendingTimers, lastErrorProvider } = runtime();
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
  const { pendingRequests, lastErrorProvider } = runtime();
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

  const seen: Set<string> = new Set();
  const recentRequests: RecentRequest[] = (await loadRecentRing())
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

    const userId: string = currentTenantId();
    let inserted: boolean = false;

    await db.transaction(async () => {
      const existing = await db.get(
        `SELECT id, endpoint FROM usageHistory
         WHERE userId = ?
           AND timestamp = ?
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(model, '') = COALESCE(?, '')
           AND COALESCE(connectionId, '') = COALESCE(?, '')
           AND COALESCE(apiKey, '') = COALESCE(?, '')
           AND promptTokens = ?
           AND completionTokens = ?
         ORDER BY id DESC LIMIT 1`,
        [
          userId, entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null,
          promptTokens, completionTokens,
        ]
      ) as { id: number; endpoint: string | null } | undefined;

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          await db.run(`UPDATE usageHistory SET endpoint = ? WHERE userId = ? AND id = ?`, [entry.endpoint, userId, existing.id]);
        }
        return;
      }

      await db.run(
        `INSERT INTO usageHistory(userId, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId, entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson(entry.meta || {}),
        ]
      );

      const dateKey: string = getLocalDateKey(entry.timestamp);
      const row = await db.get(`SELECT data FROM usageDaily WHERE userId = ? AND dateKey = ?`, [userId, dateKey]) as { data: string } | undefined;
      const day: DayData = row ? (parseJson(row.data, {}) as DayData) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      await db.run(`INSERT INTO usageDaily(userId, dateKey, data) VALUES(?, ?, ?) ON CONFLICT(userId, dateKey) DO UPDATE SET data = excluded.data`, [userId, dateKey, stringifyJson(day)]);

      await bumpTenantMeta(db, "totalRequestsLifetime");
      inserted = true;
    });

    if (inserted) {
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
  const params: unknown[] = [currentTenantId()];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where: string = conds.length ? `AND ${conds.join(" AND ")}` : "";
  const rows: Array<Record<string, unknown>> = await db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory WHERE userId = ? ${where} ORDER BY id ASC`, params);

  return rows.map((r: Record<string, unknown>) => ({
    timestamp: r.timestamp as string, provider: r.provider as string, model: r.model as string,
    connectionId: r.connectionId as string, apiKeyMasked: maskApiKey(r.apiKey as string), endpoint: r.endpoint as string,
    cost: r.cost as number, status: r.status as string, tokens: parseJson(r.tokens, {}) as Record<string, unknown>,
  }));
}

export async function getUsageStats(period: string = "all"): Promise<UsageStats> {
  const { pendingRequests, lastErrorProvider } = runtime();
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
    const rows: Array<Record<string, unknown>> = await db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory WHERE userId = ? ORDER BY id DESC LIMIT ?`,
      [currentTenantId(), limit],
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
