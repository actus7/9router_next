import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

const DEFAULT_MAX_RECORDS: number = 200;
const DEFAULT_BATCH_SIZE: number = 20;
const DEFAULT_FLUSH_INTERVAL_MS: number = 5000;
const DEFAULT_MAX_JSON_SIZE: number = 5 * 1024;
const CONFIG_CACHE_TTL_MS: number = 5000;

interface ObservabilityConfig {
  enabled: boolean;
  maxRecords: number;
  batchSize: number;
  flushIntervalMs: number;
  maxJsonSize: number;
}

let cachedConfig: ObservabilityConfig | null = null;
let cachedConfigTs: number = 0;

async function getObservabilityConfig(): Promise<ObservabilityConfig> {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo");
    const settings: Record<string, unknown> = await getSettings() as Record<string, unknown>;
    const envRequestLogs: string | undefined = process.env.ENABLE_REQUEST_LOGS;
    if (envRequestLogs !== undefined) {
      const enabled: boolean = envRequestLogs.toLowerCase() === "true";
      cachedConfig = {
        enabled,
        maxRecords: (settings.observabilityMaxRecords as number) || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
        batchSize: (settings.observabilityBatchSize as number) || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
        flushIntervalMs: (settings.observabilityFlushIntervalMs as number) || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
        maxJsonSize: ((settings.observabilityMaxJsonSize as number) || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
      };
      cachedConfigTs = Date.now();
      return cachedConfig;
    }
    const envFallback: boolean = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag: boolean = typeof settings.enableObservability === "boolean";
    const enabled: boolean = uiFlag
      ? (settings.enableObservability as boolean)
      : envFallback;

    cachedConfig = {
      enabled,
      maxRecords: (settings.observabilityMaxRecords as number) || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: (settings.observabilityBatchSize as number) || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: (settings.observabilityFlushIntervalMs as number) || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: ((settings.observabilityMaxJsonSize as number) || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

interface WriteBufferItem {
  id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  status?: string;
  latency?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  request?: Record<string, unknown>;
  providerRequest?: Record<string, unknown>;
  providerResponse?: Record<string, unknown>;
  response?: Record<string, unknown>;
  pxpipe?: unknown;
  [key: string]: unknown;
}

const writeBuffer: WriteBufferItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing: boolean = false;

function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys: string[] = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized: Record<string, unknown> = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s: string) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

const __test__ = { sanitizeHeaders };

function generateDetailId(model?: string): string {
  const timestamp: string = new Date().toISOString();
  const random: string = Math.random().toString(36).substring(2, 8);
  const modelPart: string = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj: unknown, maxSize: number): unknown {
  const str: string = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

async function flushToDatabase(): Promise<void> {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await)
    while (writeBuffer.length > 0) {
      const items: WriteBufferItem[] = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      const config: ObservabilityConfig = await getObservabilityConfig();

      db.transaction(() => {
        for (const item of items) {
          if (!item.id) item.id = generateDetailId(item.model);
          if (!item.timestamp) item.timestamp = new Date().toISOString();
          if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers as Record<string, unknown>);

          const record: Record<string, unknown> = {
            id: item.id,
            provider: item.provider || null,
            model: item.model || null,
            connectionId: item.connectionId || null,
            timestamp: item.timestamp,
            status: item.status || null,
            latency: item.latency || {},
            tokens: item.tokens || {},
            request: truncateField(item.request, config.maxJsonSize),
            providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
            providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
            response: truncateField(item.response, config.maxJsonSize),
            pxpipe: item.pxpipe || undefined,
          };

          db.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
            [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]
          );
        }

        const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`) as { c: number } | undefined;
        if (cnt && cnt.c > config.maxRecords) {
          db.run(
            `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
            [cnt.c - config.maxRecords]
          );
        }
      });
    }
  } catch (e: unknown) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail: WriteBufferItem): Promise<void> {
  const config: ObservabilityConfig = await getObservabilityConfig();
  if (!config.enabled) {return;}

  writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushToDatabase().catch((e: unknown) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

interface RequestDetailsFilter {
  provider?: string;
  model?: string;
  connectionId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface RequestDetailsResult {
  details: Record<string, unknown>[];
  pagination: Pagination;
}

export async function getRequestDetails(filter: RequestDetailsFilter = {}): Promise<RequestDetailsResult> {
  const db = await getAdapter();
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where: string = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params) as { c: number } | undefined;
  const totalItems: number = cntRow ? cntRow.c : 0;

  const page: number = filter.page || 1;
  const pageSize: number = filter.pageSize || 50;
  const totalPages: number = Math.ceil(totalItems / pageSize);
  const offset: number = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  ) as Array<{ data: string }>;
  const details: Record<string, unknown>[] = rows.map((r: { data: string }) => parseJson(r.data, {}) as Record<string, unknown>);

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getDistinctProviders(): Promise<string[]> {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`) as Array<{ provider: string }>;
  return rows.map((r: { provider: string }) => r.provider);
}

export async function getRequestDetailById(id: string): Promise<Record<string, unknown> | null> {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]) as { data: string } | undefined;
  return row ? (parseJson(row.data, null) as Record<string, unknown> | null) : null;
}

const _shutdownHandler: () => Promise<void> = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler(): void {
  process.off("beforeExit", _shutdownHandler as () => void);
  process.off("SIGINT", _shutdownHandler as () => void);
  process.off("SIGTERM", _shutdownHandler as () => void);
  process.off("exit", _shutdownHandler as () => void);

  process.on("beforeExit", _shutdownHandler as () => void);
  process.on("SIGINT", _shutdownHandler as () => void);
  process.on("SIGTERM", _shutdownHandler as () => void);
  process.on("exit", _shutdownHandler as () => void);
}

ensureShutdownHandler();
