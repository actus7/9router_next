import { getAdapter } from "../driver";
import { parseJson } from "../helpers/jsonCol";

interface PendingRequests {
  byModel: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
}

interface UsageRuntimeState {
  pendingRequests: PendingRequests;
  lastErrorProvider: { provider: string; ts: number };
}

interface Counter {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  [key: string]: unknown;
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
}

function maskApiKey(key: string | null): string | null {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

const PERIOD_MS: Record<string, number> = {
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
  "60d": 5184000000,
};

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

export interface UsageStats {
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
  apiKeyMap: Record<string, { name: string | null; id: string; createdAt: string; key: string }>;
}

export async function getUsageStatsForState(
  period: string = "all",
  state: UsageRuntimeState,
): Promise<UsageStats> {
  const { pendingRequests } = state;
  const db = await getAdapter();
  const maps = await loadReferenceMaps();
  const recentRequests = buildRecentRequests(db);
  const stats = initStats(recentRequests, state);
  buildActiveRequests(stats, maps.connectionMap, pendingRequests);
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
  const apiKeyMap: Record<string, { name: string | null; id: string; createdAt: string; key: string }> = {};
  // Indexed under both the id and the raw key. Usage rows now store the id so
  // the secret is not kept in a table that is never pruned, but rows written
  // before migration 009 still hold the raw key and have to keep resolving.
  for (const k of allApiKeys) {
    const entry = { name: k.name, id: k.id, createdAt: k.createdAt, key: k.key };
    apiKeyMap[k.id] = entry;
    apiKeyMap[k.key] = entry;
  }

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

function initStats(recentRequests: RecentRequest[], state: UsageRuntimeState): UsageStats {
  const { pendingRequests, lastErrorProvider } = state;
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

function buildActiveRequests(
  stats: UsageStats,
  connectionMap: Record<string, string>,
  pendingRequests: PendingRequests,
): void {
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
      // Mask the real key when the row resolves to one — a stored keyId is a
      // uuid, and masking a uuid would show the operator something they cannot
      // match against the key they hold.
      const apiKeyMasked: string | null = maskApiKey(keyInfo?.key ?? apiKeyVal);
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

export interface ChartBucket {
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
