import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { PROVIDER_MODELS_CONFIG, fetchWithConnectionProxy } from "./providerModelsConfig";
import { dropPaidModelsOfFreeTierProvider } from "./freeTierCatalog";

/**
 * Asks one connection's provider for its catalogue.
 *
 * Extracted from the route handler so the same three paths — OpenAI-compatible
 * base URL, Anthropic-compatible base URL, registry config or custom resolver —
 * serve both `GET /api/providers/[id]/models` and the background discovery that
 * keeps a provider's catalogue current without anybody pressing Refresh. The
 * providers reached here ship no static model list, so this is the only place
 * their models come from.
 */
export interface ListedModels {
  models?: unknown[];
  warning?: string;
  error?: string;
  status?: number;
}

type Connection = Record<string, unknown>;

async function readModels(response: Response, provider: unknown): Promise<ListedModels> {
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error fetching models from ${String(provider)}:`, errorText);
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }
  const data = await response.json();
  return { models: usable(provider, data.data || data.models || []) };
}

/** Everything leaves through here, so no discovery path keeps the paid half. */
function usable(provider: unknown, models: unknown[]): unknown[] {
  return dropPaidModelsOfFreeTierProvider(String(provider || ""), models);
}

export async function listConnectionModels(connection: Connection): Promise<ListedModels> {
  const providerSpecificData = connection.providerSpecificData as Record<string, unknown> | undefined;

  if (isOpenAICompatibleProvider(connection.provider as string)) {
    const baseUrl = providerSpecificData?.baseUrl as string | undefined;
    if (!baseUrl) return { error: "No base URL configured for OpenAI compatible provider", status: 400 };
    const response = await fetchWithConnectionProxy(`${baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${connection.apiKey}` },
    }, providerSpecificData);
    return readModels(response, connection.provider);
  }

  if (isAnthropicCompatibleProvider(connection.provider as string)) {
    let baseUrl = providerSpecificData?.baseUrl as string | undefined;
    if (!baseUrl) return { error: "No base URL configured for Anthropic compatible provider", status: 400 };
    baseUrl = baseUrl.replace(/\/$/, "");
    if (baseUrl.endsWith("/messages")) baseUrl = baseUrl.slice(0, -9);
    const response = await fetchWithConnectionProxy(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": connection.apiKey as string,
        "anthropic-version": "2023-06-01",
        "Authorization": `Bearer ${connection.apiKey}`,
      },
    }, providerSpecificData);
    return readModels(response, connection.provider);
  }

  // Connections created before canonical provider IDs were enforced can still
  // contain a UI alias (for example `naga`). Resolve it here at the boundary so
  // model discovery always uses the registry's canonical entry.
  const canonicalProviderId = normalizeProviderId(connection.provider as string);
  const config = PROVIDER_MODELS_CONFIG[canonicalProviderId];
  if (!config) {
    return { error: `Provider ${canonicalProviderId} does not support models listing`, status: 400 };
  }

  // Config-driven custom resolver path (OAuth refresh, non-OpenAI shape, etc.)
  if (typeof config.customResolver === "function") {
    const result = await config.customResolver(connection) as ListedModels;
    if (result.error) return { error: result.error, status: result.status || 500 };
    return {
      models: usable(canonicalProviderId, result.models || []),
      ...(result.warning ? { warning: result.warning } : {}),
    };
  }

  const token = providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
  if (!token) return { error: "No valid token found", status: 401 };

  let url = config.url as string;
  if (canonicalProviderId === "ollama") {
    const configuredBaseUrl = providerSpecificData?.baseUrl;
    const baseUrl = typeof configuredBaseUrl === "string" && configuredBaseUrl.trim()
      ? configuredBaseUrl.trim().replace(/\/$/, "")
      : "https://ollama.com";
    url = baseUrl.endsWith("/api/tags") ? baseUrl : `${baseUrl}/api/tags`;
  }
  if (config.authQuery) url += `?${config.authQuery}=${token}`;

  const headers: Record<string, string> = { ...(config.headers as Record<string, string>) };
  if (config.authHeader && !config.authQuery) {
    headers[config.authHeader as string] = ((config.authPrefix as string) || "") + token;
  }

  const fetchOptions: RequestInit = { method: config.method as string, headers };
  if (config.body && config.method === "POST") fetchOptions.body = JSON.stringify(config.body);

  const response = await fetchWithConnectionProxy(url, fetchOptions, providerSpecificData);
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error fetching models from ${connection.provider}:`, errorText);
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }

  const data = await response.json();
  return { models: usable(canonicalProviderId, (config.parseResponse as (data: unknown) => unknown[])(data)) };
}
