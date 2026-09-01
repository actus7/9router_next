import { resolveKiroModels, resolveKimchiModels, resolveQoderModels, resolveCopilotModels, resolveClinepassModels, resolveGrokCliModels, resolveCursorModels, resolveZedModels } from "@/server/llm-gateway/catalog";
import { updateProviderCredentials } from "@/server/llm-gateway/auth";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
export interface ConnectionRecord {
  id: string;
  accessToken: string;
  refreshToken?: string;
  apiKey?: string;
  email?: string;
  displayName?: string;
  provider?: string;
  providerSpecificData?: Record<string, unknown>;
  isActive?: boolean;
}

export const LIVE_MODEL_RESOLVERS: Record<string, (conn: ConnectionRecord) => Promise<{ models: Array<Record<string, unknown>> } | null>> = {
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveKiroModels>[0], { log: console });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      email: conn.email,
      displayName: conn.displayName,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveQoderModels>[0]);
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: (m as Record<string, unknown>).id, name: (m as Record<string, unknown>).name })),
    };
  },
  kimchi: async (conn) => {
    const result = await resolveKimchiModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveKimchiModels>[0], { log: console });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveCopilotModels>[0], {
      log: console,
      onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken as string,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt as number,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    } as Parameters<typeof resolveClinepassModels>[0]);
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    } as Parameters<typeof resolveGrokCliModels>[0], {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
        connectionNoProxy: proxy.connectionNoProxy || "",
        vercelRelayUrl: proxy.vercelRelayUrl || "",
        strictProxy: proxy.strictProxy === true,
      },
      onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        } as Parameters<typeof updateProviderCredentials>[1]);
      },
    });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    } as Parameters<typeof resolveCursorModels>[0], { log: console });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  zed: async (conn) => {
    const result = await resolveZedModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    } as Parameters<typeof resolveZedModels>[0]);
    if (!result?.models?.length) return null;
    return {
      models: result.models
        .filter((m) => !(m as unknown as Record<string, unknown>).isDisabled)
        .map((m) => {
          const r = m as unknown as Record<string, unknown>;
          return {
            id: r.id,
            name: r.name,
            capabilities: r.supportsTools ? { tools: true } : undefined,
          };
        }),
    };
  },
};

