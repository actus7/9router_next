import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

const DEFAULT_HEADROOM_URL: string = process.env.HEADROOM_URL || "http://localhost:8787";

interface Settings {
  cloudEnabled: boolean;
  /** Read by `getCloudUrl()`, which falls back to CLOUD_URL / NEXT_PUBLIC_CLOUD_URL. */
  cloudUrl: string;
  tunnelEnabled: boolean;
  tunnelUrl: string;
  tunnelProvider: string;
  tailscaleEnabled: boolean;
  tailscaleUrl: string;
  stickyRoundRobinLimit: number;
  providerStrategies: Record<string, unknown>;
  quotaVisibility: Record<string, unknown>;
  comboStrategy: string;
  comboStickyRoundRobinLimit: number;
  comboStrategies: Record<string, unknown>;
  capacityAdapter: Record<string, { enabled: boolean; roundRobin: boolean; models: string[] }>;
  requireApiKey: boolean;
  /**
   * Login is no longer a setting. Identity comes from Neon Auth and every row
   * is owned by an account, so there is no "no login" mode left to configure —
   * see docs/NEON-MIGRATION.md. Serving the dashboard on a given host is a
   * deployment concern now: `DASHBOARD_ALLOWED_HOSTS`.
   */
  enableObservability: boolean;
  observabilityMaxRecords: number;
  observabilityBatchSize: number;
  observabilityFlushIntervalMs: number;
  observabilityMaxJsonSize: number;
  outboundProxyEnabled: boolean;
  outboundProxyUrl: string;
  outboundNoProxy: string;
  rtkEnabled: boolean;
  headroomEnabled: boolean;
  headroomUrl: string;
  headroomCompressUserMessages: boolean;
  cavemanEnabled: boolean;
  cavemanLevel: string;
  ponytailEnabled: boolean;
  ponytailLevel: string;
  synapseEnabled: boolean;
  synapseLevel: string;
  metaBreakEnabled: boolean;
  pxpipeEnabled: boolean;
  pxpipeAutoInstall: boolean;
  pxpipeMinChars: number;
  pxpipeTimeoutMs: number;
  /**
   * Answer through the credential-free default provider when the requested one
   * has no usable account left, instead of failing the request. On by default
   * so a fresh install works, and an off switch because it does send the
   * prompt to a provider the operator did not configure.
   */
  freeFallbackEnabled: boolean;
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: Settings = {
  cloudEnabled: false,
  cloudUrl: "",
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireApiKey: true,
  enableObservability: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  synapseEnabled: false,
  synapseLevel: "lite",
  metaBreakEnabled: false,
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  freeFallbackEnabled: true,
};

async function readRaw(): Promise<Record<string, unknown>> {
  const db = await getAdapter();
  const row = (await db.get(`SELECT data FROM settings WHERE userId = ?`, [currentTenantId()])) as { data: string } | undefined;
  return row ? (parseJson(row.data, {}) as Record<string, unknown>) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw: Record<string, unknown>): Settings {
  raw = normalizeMetaBreakSettings(raw);
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(raw || {}) } as Settings;
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if ((merged as Record<string, unknown>)[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        (merged as Record<string, unknown>)[key] = true;
      } else {
        (merged as Record<string, unknown>)[key] = defVal;
      }
    }
  }
  return merged;
}

export async function getSettings(): Promise<Settings> {
  const raw: Record<string, unknown> = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates: Record<string, unknown>): Promise<Settings> {
  const db = await getAdapter();
  const userId = currentTenantId();
  let next: Settings;
  await db.transaction(async () => {
    const row = (await db.get(`SELECT data FROM settings WHERE userId = ?`, [userId])) as { data: string } | undefined;
    const current: Record<string, unknown> = row ? (parseJson(row.data, {}) as Record<string, unknown>) : {};
    next = { ...normalizeMetaBreakSettings(current), ...normalizeMetaBreakSettings(updates) } as Settings;
    await db.run(
      `INSERT INTO settings(userId, data) VALUES(?, ?) ON CONFLICT(userId) DO UPDATE SET data = excluded.data`,
      [userId, stringifyJson(next)],
    );
  });
  return mergeWithDefaults(next!);
}

export async function isCloudEnabled(): Promise<boolean> {
  const settings: Settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl(): Promise<string> {
  const settings: Settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings(): Promise<Record<string, unknown>> {
  return normalizeMetaBreakSettings(await readRaw());
}

// Read legacy toggles without retaining the retired user-editable prompt.
function normalizeMetaBreakSettings(raw: Record<string, unknown>): Record<string, unknown> {
  const { jailbreakEnabled, jailbreakPrompt: _legacyPrompt, metaBreakPrompt: _prompt, ...settings } = raw;
  if (typeof settings.metaBreakEnabled !== "boolean" && typeof jailbreakEnabled === "boolean") {
    settings.metaBreakEnabled = jailbreakEnabled;
  }
  if ("metaBreakEnabled" in settings) settings.metaBreakEnabled = settings.metaBreakEnabled === true;
  return settings;
}
