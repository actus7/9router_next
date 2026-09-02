import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

const DEFAULT_HEADROOM_URL: string = process.env.HEADROOM_URL || "http://localhost:8787";

interface Settings {
  cloudEnabled: boolean;
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
  requireLogin: boolean;
  requireApiKey: boolean;
  tunnelDashboardAccess: boolean;
  authMode: string;
  ssoType: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcScopes: string;
  oidcLoginLabel: string;
  samlEntryPoint: string;
  samlIssuer: string;
  samlCert: string;
  samlLoginLabel: string;
  samlAttributeEmail: string;
  samlAttributeName: string;
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
  pxpipeEnabled: boolean;
  pxpipeAutoInstall: boolean;
  pxpipeMinChars: number;
  pxpipeTimeoutMs: number;
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: Settings = {
  cloudEnabled: false,
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
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  ssoType: "oidc",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  samlEntryPoint: "",
  samlIssuer: "urn:modelhub:sp",
  samlCert: "",
  samlLoginLabel: "Sign in with SAML SSO",
  samlAttributeEmail: "email",
  samlAttributeName: "name",
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
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
};

async function readRaw(): Promise<Record<string, unknown>> {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`) as { data: string } | undefined;
  return row ? (parseJson(row.data, {}) as Record<string, unknown>) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw: Record<string, unknown>): Settings {
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
  let next: Settings;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`) as { data: string } | undefined;
    const current: Record<string, unknown> = row ? (parseJson(row.data, {}) as Record<string, unknown>) : {};
    next = { ...current, ...updates } as Settings;
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
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
    (settings.cloudUrl as string) ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings(): Promise<Record<string, unknown>> {
  return await readRaw();
}
