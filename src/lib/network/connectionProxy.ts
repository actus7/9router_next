import { getProxyPoolById } from "@/models";

function normalizeString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

interface RotateState {
  index: number;
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState: Map<string, RotateState> = new Map(); // providerId → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 */
export function pickProxyPoolId(poolIds: string[], strategy: string, providerId: string): string | null {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "round-robin") {
    const state: RotateState = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return poolIds[0]; // "none" or unknown
}

interface LegacyProxyConfig {
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData: Record<string, unknown> = {}): LegacyProxyConfig {
  const connectionProxyEnabled: boolean =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl: string = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy: string = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

interface ProxyPool {
  isActive: boolean;
  proxyUrl: string;
  noProxy?: string;
  type?: string;
  strictProxy?: boolean;
  [key: string]: unknown;
}

interface ProxyConfigResult {
  source: string;
  proxyPoolId: string | null;
  proxyPool: ProxyPool | null;
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
  strictProxy?: boolean;
  vercelRelayUrl?: string;
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData: Record<string, unknown> = {}
): Promise<ProxyConfigResult> {
  try {
    const proxyPoolIdRaw: string = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId: string =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy: LegacyProxyConfig = normalizeLegacyProxy(providerSpecificData);

    if (proxyPoolId) {
      const proxyPool: ProxyPool | null = await getProxyPoolById(proxyPoolId) as ProxyPool | null;

      const proxyUrl: string = normalizeString(proxyPool?.proxyUrl);
      const noProxy: string = normalizeString(proxyPool?.noProxy);

      if (proxyPool && proxyPool.isActive === true && proxyUrl) {
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno") {
          return {
            source: proxyPool.type!,
            proxyPoolId,
            proxyPool,
            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,
            strictProxy: proxyPool.strictProxy === true,
            vercelRelayUrl: proxyUrl,
          };
        }

        return {
          source: "pool",
          proxyPoolId,
          proxyPool,
          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,
          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",
        proxyPoolId: proxyPoolId || null,
        proxyPool: null,
        ...legacy,
      };
    }

    return {
      source: "none",
      proxyPoolId: proxyPoolId || null,
      proxyPool: null,
      ...legacy,
    };
  } catch (error: unknown) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",
      proxyPoolId: null,
      proxyPool: null,
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      strictProxy: false,
    };
  }
}
