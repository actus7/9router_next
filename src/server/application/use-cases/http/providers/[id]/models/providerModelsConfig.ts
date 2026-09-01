import { GEMINI_CONFIG } from "@/lib/oauth/constants/oauth";
import { refreshGoogleToken, refreshCodexToken, updateProviderCredentials } from "@/server/llm-gateway/auth";
import { getModelsByProviderId, resolveKiroModels, resolveKimchiModels, resolveQoderModels, resolveGrokCliModels, resolveCursorModels } from "@/server/llm-gateway/catalog";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

// The /codex/models endpoint gates each entry by minimal_client_version against this
// value, and codex CLI's own manifest (openai/codex codex-rs/models-manager/models.json)
// already requires 0.144.0 for its newest models, so a stale client_version here comes
// back 200 with those entries quietly missing instead of erroring.
const CODEX_CLIENT_VERSION = "0.144.6";
const CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`;

const parseOpenAIStyleModels = (data: unknown): Record<string, unknown>[] => {
  const models = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.data || (data as Record<string, unknown>)?.models || (data as Record<string, unknown>)?.results || []) as unknown[];
  if (!Array.isArray(models)) return [];
  return models.flatMap((model) => {
    if (typeof model === "string" && model.trim()) return [{ id: model, name: model }];
    if (!model || typeof model !== "object" || Array.isArray(model)) return [];
    const record = model as Record<string, unknown>;
    const id = [record.id, record.model, record.name, record.slug].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return id ? [{ ...record, id, name: typeof record.name === "string" ? record.name : id }] : [];
  });
};

// Google returns model resources as `models/{id}` while the rest of the
// gateway (catalogue, routing, and chat) uses the canonical bare `{id}`.
// Normalize at the API boundary so a catalogue refresh cannot mistake every
// configured Gemini model for a removed one.
const parseGeminiModels = (data: Record<string, unknown>): Record<string, unknown>[] => {
  const models = Array.isArray(data?.models) ? data.models as Record<string, unknown>[] : [];
  return models.map((model) => {
    const rawId = typeof model?.id === "string"
      ? model.id
      : typeof model?.name === "string"
        ? model.name
        : typeof model?.model === "string"
          ? model.model
          : "";
    const id = rawId.replace(/^models\//, "");
    if (!id) return model;
    return {
      ...model,
      id,
      name: (typeof model.displayName === "string" && model.displayName) || id,
    };
  });
};

const parseGeminiCliModels = (data: Record<string, unknown>): Array<{ id: string; name: string }> => {
  if (Array.isArray(data?.models)) {
    return data.models
      .map((item: Record<string, unknown>) => {
        const id = (item?.id || item?.model || item?.name) as string;
        if (!id) return null;
        return { id, name: (item?.displayName || item?.name || id) as string };
      })
      .filter(Boolean) as Array<{ id: string; name: string }>;
  }

  if (data?.models && typeof data.models === "object") {
    return Object.entries(data.models as Record<string, Record<string, unknown>>)
      .filter(([, info]) => !info?.isInternal)
      .map(([id, info]) => ({
        id,
        name: (info?.displayName || info?.name || id) as string,
      }));
  }

  return [];
};

const appendCodexReviewModels = (models: Record<string, unknown>[]): Record<string, unknown>[] => models.flatMap((model) => {
  const id = (model?.id || model?.slug || model?.model || model?.name) as string;
  if (!id) return [];
  const name = (model?.display_name || model?.displayName || model?.name || id) as string;
  const normalized = { ...model, id, name };
  const isChatModel = ((model?.type as string) || "llm") !== "image" && !id.toLowerCase().includes("embed");
  if (!isChatModel || id.endsWith("-review")) return [normalized];
  return [
    normalized,
    {
      ...normalized,
      id: `${id}-review`,
      name: `${name} Review`,
      upstreamModelId: id,
      quotaFamily: "review",
    },
  ];
});

const parseCodexModels = (data: unknown): Record<string, unknown>[] => appendCodexReviewModels(parseOpenAIStyleModels(data) as Record<string, unknown>[]);

const createOpenAIModelsConfig = (url: string) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels
});

export async function fetchWithConnectionProxy(
  url: string,
  options: RequestInit,
  providerSpecificData: Record<string, unknown> | null | undefined,
): Promise<Response> {
  const proxy = (await resolveConnectionProxyConfig(providerSpecificData || {})) || {};
  if (proxy.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, { vercelRelayUrl: proxy.vercelRelayUrl });
  }
  if (proxy.connectionProxyEnabled && proxy.connectionProxyUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, {
      connectionProxyEnabled: true,
      connectionProxyUrl: proxy.connectionProxyUrl,
      connectionNoProxy: proxy.connectionNoProxy || "",
    });
  }
  return fetch(url, options);
}

// Volcengine Ark / BytePlus ModelArk catalog entries carry task_type + domain
// metadata that distinguishes chat (TextGeneration) from embedding/image/video
// models. Map to the gateway's kind vocabulary so consumers (Test All Models,
// custom-model persistence) treat each model with the right endpoint instead of
// pinging image/video models through chat/completions. Entries without metadata
// default to "llm" (previous behavior).
const ARK_KIND_BY_TASK: Array<[RegExp, string]> = [
  [/embedding/i, "embedding"],
  [/texttoimage|imagetoimage|imageedit/i, "image"],
  [/video/i, "video"],
  [/textgeneration|chat/i, "llm"],
];
const arkKindOf = (m: Record<string, unknown>): string => {
  const tasks = Array.isArray(m.task_type) ? m.task_type.map(String) : [];
  const domain = String(m.domain || "");
  for (const [pattern, kind] of ARK_KIND_BY_TASK) {
    if (tasks.some((t) => pattern.test(t)) || (domain && pattern.test(domain))) return kind;
  }
  return "llm";
};
const parseArkModels = (data: unknown): Record<string, unknown>[] =>
  (parseOpenAIStyleModels(data) as Record<string, unknown>[]).map((m) => {
    const id = (m.id || m.name) as string;
    return { ...m, id, name: (m.name || id) as string, kind: arkKindOf(m) };
  });
const createArkModelsConfig = (url: string) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseArkModels
});

const getStaticProviderModels = (providerId: string) =>
  getModelsByProviderId(providerId).map((model: Record<string, unknown>) => ({
    ...model,
    id: model.id as string,
    name: (model.name as string) || (model.id as string),
  }));

// Generic custom resolver for OAuth providers that need refresh-on-401 + token persist.
// Receives a `fetchFn(token)` and returns parsed models or throws.
const buildOAuthResolver = ({ refreshFn, fetchFn, parseFn, errorLabel }: {
  refreshFn: (conn: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  fetchFn: (token: string, conn: Record<string, unknown>) => Promise<Response>;
  parseFn: (data: unknown) => unknown[];
  errorLabel: string;
}) => async (connection: Record<string, unknown>): Promise<{ models?: unknown[]; error?: string; status?: number; warning?: string }> => {
  const { accessToken, refreshToken } = connection;
  if (!accessToken) {
    return { error: "No valid token found", status: 401 };
  }
  let warning: string | undefined;
  try {
    let response = await fetchFn(accessToken as string, connection);
    if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
      const refreshed = await refreshFn(connection);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id as string, {
          accessToken: refreshed.accessToken as string,
          refreshToken: (refreshed.refreshToken as string) || (refreshToken as string),
          expiresIn: refreshed.expiresIn as number | undefined,
        });
        connection.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
        response = await fetchFn(refreshed.accessToken as string, connection);
      }
    }
    if (response.ok) {
      const data = await response.json();
      const models = parseFn(data);
      if (models.length > 0) return { models };
    } else {
      const errorText = await response.text();
      warning = `${errorLabel}: ${response.status} ${errorText}`;
      console.log(`${errorLabel} (falling back to static):`, errorText);
    }
  } catch (error) {
    warning = `${errorLabel}: ${(error as Error).message}`;
    console.error(`${errorLabel} (falling back to static):`, (error as Error).message);
  }
  return { models: [], warning };
};

// Provider models endpoints configuration
export const PROVIDER_MODELS_CONFIG: Record<string, Record<string, unknown>> = {
  claude: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key",
    parseResponse: parseGeminiModels
  },
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
  antigravity: {
    url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    body: {},
    parseResponse: (data: Record<string, unknown>) => data.models || []
  },
  github: {
    url: "https://api.githubcopilot.com/models",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7"
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => {
      if (!data?.data) return [];
      return (data.data as Record<string, unknown>[])
        .filter(m => (m.capabilities as Record<string, unknown>)?.type === "chat")
        .filter(m => (m.policy as Record<string, unknown>)?.state !== "disabled")
        .map(m => ({
          id: m.id,
          name: m.name || m.id,
          version: m.version,
          capabilities: m.capabilities,
          isDefault: m.model_picker_enabled === true
        }));
    }
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  "api-airforce": createOpenAIModelsConfig("https://api.airforce/v1/models"),
  "kilo-gateway": createOpenAIModelsConfig("https://api.kilo.ai/api/gateway/models"),
  poolside: createOpenAIModelsConfig("https://inference.poolside.ai/v1/models"),
  // Naga exposes an authenticated, OpenAI-compatible /v1/models endpoint.
  // Keep this explicit entry in sync with its registry modelsFetcher so the
  // provider detail screen can refresh the live catalog.
  "naga-ac": createOpenAIModelsConfig("https://api.naga.ac/v1/models"),
  aihorde: createOpenAIModelsConfig("https://oai.aihorde.net/v1/models"),
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  alicode: {
    url: "https://coding.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  "alicode-intl": {
    url: "https://coding-intl.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  "alims-intl": {
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  "volcengine-ark": createArkModelsConfig("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  byteplus: createArkModelsConfig("https://ark.ap-southeast.bytepluses.com/api/v3/models"),
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  perplexity: createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  "perplexity-agent": createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.com/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  ollama: {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseOpenAIStyleModels,
  },
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"),
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
  "vercel-ai-gateway": createOpenAIModelsConfig("https://ai-gateway.vercel.sh/v1/models"),
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
  // theoldllm.vercel.app exposes only a chat-completions endpoint, no models-list
  // endpoint (confirmed against the upstream reference implementation too) — refresh
  // re-syncs to the curated static catalog instead of erroring with "not supported".
  theoldllm: {
    customResolver: async () => ({ models: getStaticProviderModels("theoldllm") })
  }
};

