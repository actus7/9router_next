import {
  GROK_CLI_BASE_URL,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_MODEL,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../config/grokCli";
import { refreshProviderCredentials } from "./oauthCredentialManager";
import { proxyAwareFetch } from "../utils/proxyFetch";

const MODELS_URL = `${GROK_CLI_BASE_URL}/models`;

function modelEntries(data: unknown): [string | null, unknown][] {
  const d = data as Record<string, unknown> | null | undefined;
  const value = Array.isArray(data) ? data : d?.data ?? d?.models ?? d?.results ?? [];
  if (Array.isArray(value)) return value.map((item: unknown) => [null, item]);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return [];
}

function parseGrokCliModels(data: unknown): Record<string, unknown>[] {
  const seen = new Set<string>();
  const models: Record<string, unknown>[] = [];

  for (const [key, raw] of modelEntries(data)) {
    const item = typeof raw === "string" ? { id: raw } : raw as Record<string, unknown>;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = String(
      item.id ?? item.model_id ?? item.modelId ?? item.model ?? item.slug ?? key ?? item.name ?? "",
    ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const model: Record<string, unknown> = {
      ...item,
      id,
      name: item.display_name ?? item.displayName ?? item.name ?? id,
    };
    const contextLength = Number(
      item.context_length ?? item.contextLength ?? item.context_window ?? item.contextWindow,
    );
    const maxOutputTokens = Number(item.max_output_tokens ?? item.maxOutputTokens);
    if (Number.isFinite(contextLength) && contextLength > 0) model.contextLength = contextLength;
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      model.maxOutputTokens = maxOutputTokens;
    }
    if (id === GROK_CLI_MODEL) {
      model.contextLength ||= 500000;
      model.maxOutputTokens ||= 64000;
    }
    models.push(model);
  }

  return models;
}

function buildHeaders(accessToken: string, providerSpecificData: Record<string, unknown> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-mode": "headless",
  };
  const email = providerSpecificData?.email;
  const userId = providerSpecificData?.userId || providerSpecificData?.principalId;
  if (email) headers["x-email"] = email as string;
  if (userId) headers["x-userid"] = userId as string;
  return headers;
}

export async function resolveGrokCliModels(credentials: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const {
    fetchFn = proxyAwareFetch,
    log = console,
    proxyOptions = null,
    onCredentialsRefreshed,
  } = options as {
    fetchFn?: typeof proxyAwareFetch;
    log?: { warn?: (tag: string, msg: string, meta?: unknown) => void };
    proxyOptions?: unknown;
    onCredentialsRefreshed?: (data: Record<string, unknown>) => Promise<void>;
  };
  let accessToken = (credentials?.accessToken as string) || "";
  if (!accessToken) return { models: [], warning: "Grok CLI access token is missing." };

  const request = (token: string) => (fetchFn as typeof proxyAwareFetch)(
    MODELS_URL,
    {
      method: "GET",
      headers: buildHeaders(token, (credentials?.providerSpecificData || {}) as Record<string, unknown>),
    },
    proxyOptions as null,
  );

  try {
    let response = await request(accessToken) as Response;
    if ((response.status === 401 || response.status === 403) && credentials?.refreshToken) {
      const refreshed = await refreshProviderCredentials(
        "grok-cli",
        credentials as unknown as import("./types").Credentials,
        log as unknown as import("./types").Logger,
      );
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken as string;
        try {
          await onCredentialsRefreshed?.(refreshed as Record<string, unknown>);
        } catch (error: unknown) {
          log?.warn?.("Grok CLI credential persistence failed", error instanceof Error ? error.message : String(error));
        }
        response = await request(accessToken) as Response;
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        models: [],
        warning: `Grok CLI model discovery failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }

    const models = parseGrokCliModels(await response.json());
    return models.length
      ? { models }
      : { models: [], warning: "Grok CLI returned no selectable models." };
  } catch (error: unknown) {
    return { models: [], warning: `Grok CLI model discovery failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
