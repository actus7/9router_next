import { GEMINI_CONFIG } from "@/lib/oauth/constants/oauth";
import { refreshGoogleToken, refreshCodexToken, updateProviderCredentials } from "@/server/llm-gateway/auth";
import {
  getModelsByProviderId,
  resolveKiroModels,
  resolveKimchiModels,
  resolveQoderModels,
  resolveGrokCliModels,
  resolveCursorModels,
} from "@/server/llm-gateway/catalog";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { resolveXiaomiTokenplanBaseUrl } from "@/server/llm-gateway/engine/config/providers";
import { buildOAuthResolver } from "./providerModelsOAuth";
import {
  CODEX_MODELS_URL,
  GEMINI_CLI_MODELS_URL,
  parseCodexModels,
  parseGeminiCliModels,
  parseOpenAIStyleModels,
} from "./providerModelsParsers";
import { fetchWithConnectionProxy } from "./providerModelsProxy";

const getStaticProviderModels = (providerId: string) =>
  getModelsByProviderId(providerId).map((model: Record<string, unknown>) => ({
    ...model,
    id: model.id as string,
    name: (model.name as string) || (model.id as string),
  }));

export const PROVIDER_MODELS_CUSTOM_RESOLVERS: Record<string, Record<string, unknown>> = {
  codex: {
    customResolver: buildOAuthResolver({
      refreshFn: (conn) => refreshCodexToken(conn.refreshToken as string),
      fetchFn: (token) => fetch(CODEX_MODELS_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "originator": "codex_cli_rs"
        }
      }),
      parseFn: parseCodexModels,
      errorLabel: "Failed to fetch Codex models"
    })
  },
  kimchi: {
    customResolver: async (connection: Record<string, unknown>) => {
      const result = await resolveKimchiModels({
        accessToken: connection.accessToken as string,
        apiKey: connection.apiKey as string,
        providerSpecificData: (connection.providerSpecificData || {}) as Record<string, unknown>,
      }, { forceRefresh: true, log: console });
      if (result?.models?.length) {
        return { models: result.models };
      }
      return {
        models: getStaticProviderModels("kimchi"),
        warning: "Kimchi returned no live models; falling back to static catalog.",
      };
    }
  },
  cursor: {
    customResolver: async (connection: Record<string, unknown>) => {
      const result = await resolveCursorModels({
        accessToken: connection.accessToken as string,
        providerSpecificData: (connection.providerSpecificData || {}) as Record<string, unknown>,
      }, { forceRefresh: true, log: console });
      if (result?.models?.length) return { models: result.models };
      return {
        models: getStaticProviderModels("cursor"),
        warning: "Cursor returned no live models; falling back to static catalog.",
      };
    },
  },
  kiro: {
    customResolver: async (connection: Record<string, unknown>) => {
      const credentials = {
        accessToken: connection.accessToken as string,
        refreshToken: connection.refreshToken as string,
        providerSpecificData: (connection.providerSpecificData || {}) as Record<string, unknown>
      };
      let warning: string | undefined;
      try {
        const result = await resolveKiroModels(credentials, {
          log: console,
          onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
            if (refreshed?.accessToken) {
              await updateProviderCredentials(connection.id as string, {
                accessToken: refreshed.accessToken as string,
                refreshToken: (refreshed.refreshToken as string) || (connection.refreshToken as string),
                expiresIn: refreshed.expiresIn as number | undefined,
              });
              connection.accessToken = refreshed.accessToken;
              if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
            }
          }
        });
        if (result?.models?.length) {
          return {
            models: result.models.map((m: unknown) => {
              const rec = m as Record<string, unknown>;
              return {
                id: rec.id,
                name: rec.name,
                upstreamModelId: rec.upstreamModelId,
                contextLength: rec.contextLength,
                rateMultiplier: rec.rateMultiplier,
                capabilities: rec.capabilities,
                description: rec.description,
              };
            })
          };
        }
        warning = "Kiro returned no models; falling back to static catalog.";
      } catch (error) {
        warning = `Failed to fetch Kiro models: ${(error as Error).message}`;
        console.error("Failed to fetch Kiro models dynamically, falling back to static:", (error as Error).message);
      }
      return { models: [], warning };
    }
  },
  qoder: {
    customResolver: async (connection: Record<string, unknown>) => {
      const credentials = {
        accessToken: connection.accessToken as string,
        apiKey: connection.apiKey as string,
        refreshToken: connection.refreshToken as string,
        email: connection.email as string,
        displayName: connection.displayName as string,
        providerSpecificData: (connection.providerSpecificData || {}) as Record<string, unknown>,
      };
      let warning: string | undefined;
      try {
        const result = await resolveQoderModels(credentials, { forceRefresh: true });
        if (result?.models?.length) {
          return {
            models: result.models.map((m: Record<string, unknown>) => ({
              id: `qoder/${m.id}`,
              name: m.name,
              contextLength: m.contextLength,
              isVL: m.isVL,
              isReasoning: m.isReasoning,
              maxOutputTokens: m.maxOutputTokens,
              description: m.description,
            })),
          };
        }
        warning = "Qoder returned no models; falling back to static catalog.";
      } catch (error) {
        warning = `Failed to fetch Qoder models: ${(error as Error).message}`;
        console.error("Failed to fetch Qoder models dynamically, falling back to static:", (error as Error).message);
      }
      return { models: [], warning };
    },
  },
  "gemini-cli": {
    customResolver: buildOAuthResolver({
      refreshFn: (conn) => refreshGoogleToken(conn.refreshToken as string, GEMINI_CONFIG.clientId as string, GEMINI_CONFIG.clientSecret as string),
      fetchFn: (token, conn) => {
        const projectId = (conn.projectId || (conn.providerSpecificData as Record<string, unknown>)?.projectId) as string;
        const body = projectId ? { project: projectId } : {};
        return fetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
          },
          body: JSON.stringify(body)
        });
      },
      parseFn: (data) => parseGeminiCliModels(data as Record<string, unknown>),
      errorLabel: "Failed to fetch Gemini CLI models"
    })
  },
  "grok-cli": {
    customResolver: async (connection: Record<string, unknown>) => {
      const proxy = await resolveConnectionProxyConfig((connection.providerSpecificData || {}) as Record<string, unknown>);
      const result = await resolveGrokCliModels({
        ...connection,
        connectionId: connection.id,
      } as Record<string, unknown>, {
        log: console,
        proxyOptions: {
          connectionProxyEnabled: proxy.connectionProxyEnabled === true,
          connectionProxyUrl: proxy.connectionProxyUrl || "",
          connectionNoProxy: proxy.connectionNoProxy || "",
          vercelRelayUrl: proxy.vercelRelayUrl || "",
          strictProxy: proxy.strictProxy === true,
        },
        onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
          await updateProviderCredentials(connection.id as string, {
            ...refreshed,
            existingProviderSpecificData: (connection.providerSpecificData || {}) as Record<string, unknown>,
          });
        },
      });
      if (result.models.length) return result;
      return {
        models: getStaticProviderModels("grok-cli"),
        warning: result.warning || "Grok CLI returned no live models; using static catalog.",
      };
    },
  },
  theoldllm: {
    customResolver: async () => ({ models: getStaticProviderModels("theoldllm") })
  },
  "xiaomi-tokenplan": {
    customResolver: async (connection: Record<string, unknown>) => {
      const providerSpecificData = (connection.providerSpecificData || {}) as Record<string, unknown>;
      const baseUrl = resolveXiaomiTokenplanBaseUrl({ providerSpecificData });
      const token = connection.apiKey as string | undefined;
      if (!baseUrl) return { error: "No region configured for Xiaomi Token Plan", status: 400 };
      if (!token) return { error: "No valid token found", status: 401 };
      const response = await fetchWithConnectionProxy(`${baseUrl}/models`, {
        method: "GET",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      }, providerSpecificData);
      if (!response.ok) {
        return { error: `Failed to fetch models: ${response.status}`, status: response.status };
      }
      return { models: parseOpenAIStyleModels(await response.json()) };
    },
  },
  "xiaomi-mimo": {
    customResolver: async (connection: Record<string, unknown>) => {
      const providerSpecificData = (connection.providerSpecificData || {}) as Record<string, unknown>;
      const token = connection.apiKey as string | undefined;
      if (!token) return { error: "No valid token found", status: 401 };
      const response = await fetchWithConnectionProxy("https://api.xiaomimimo.com/v1/models", {
        method: "GET",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      }, providerSpecificData);
      if (!response.ok) {
        return { error: `Failed to fetch models: ${response.status}`, status: response.status };
      }
      return { models: parseOpenAIStyleModels(await response.json()) };
    },
  },
};
