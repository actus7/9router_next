import { testStatusForValidation } from "@/lib/db/repos/connectionsRepo";
import { NextRequest, NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  setProviderConnectionsActive,
  updateProviderConnection,
  deleteProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";


interface ProxyConfigResult {
  error?: string;
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
}

function normalizeProxyConfig(body: Record<string, unknown> = {}): ProxyConfigResult {
  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? (body.connectionProxyUrl as string).trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? (body.connectionNoProxy as string).trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled", connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "" };
  }

  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolId(proxyPoolId: unknown): Promise<{ proxyPoolId: string | null; error?: string }> {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }

  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) {
    return { proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) {
    return { error: "Proxy pool not found", proxyPoolId: null };
  }

  return { proxyPoolId: normalizedId };
}

// GET /api/providers - List all connections
export async function GET(): Promise<NextResponse> {
  try {
    // O cruzamento entre os dois é feito depois, em memória: nenhuma das leituras
    // recebe o resultado da outra.
    const [connections, nodes] = await Promise.all([
      getProviderConnections(),
      // Compatible providers then fall back to showing their raw id as the name,
      // which looks like a data bug unless the real cause is recorded here.
      getProviderNodes().catch((error) => {
        console.error("Error in providers GET: node name lookup failed:", error);
        return [];
      }),
    ]);

    // Build nodeNameMap for compatible providers (id → name)
    const nodeNameMap: Record<string, string> = {};
    for (const node of nodes) {
      if (node.id && node.name) nodeNameMap[node.id] = node.name;
    }

    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = connections.map((c: Record<string, unknown>) => {
      const isCompatible = isOpenAICompatibleProvider(c.provider as string) || isAnthropicCompatibleProvider(c.provider as string);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider as string] || (c.providerSpecificData as Record<string, unknown>)?.nodeName || c.provider)
        : c.name;
      return {
        ...c,
        name,
        apiKey: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        idToken: undefined,
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.error("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    // Dashboard forms send the canonical ID explicitly. Keep `provider` as a
    // backwards-compatible alias input for older clients and integrations.
    const provider = normalizeProviderId(typeof body.providerId === "string" ? body.providerId : body.provider);
    const { apiKey, name, displayName, priority, globalPriority, defaultModel } = body;
    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const proxyPoolId = proxyPoolResult.proxyPoolId;

    // Validation
    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    // Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also
    // accept an API key via authModes — they aren't in APIKEY_PROVIDERS, so allow them here.
    const supportsApiKeyMode = !!(AI_PROVIDERS[provider]?.authModes as string[] | undefined)?.includes("apikey")
      || AI_PROVIDERS[provider]?.authType === "apikey";
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      // Some providers, such as Naga, are free-tier services that still use
      // an optional API key. They are stored in the `free` catalog group.
      FREE_PROVIDERS[provider] ||
      FREE_TIER_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const connectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);

    // Compatible LLM nodes support multiple API-key connections (key pool); runtime
    // rotates/fails over via getProviderCredentials. Embedding nodes stay single-connection.
    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const mergedProviderSpecificData: Record<string, unknown> = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
    };

    if (proxyPoolId !== null) {
      mergedProviderSpecificData.proxyPoolId = proxyPoolId;
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      // The browser reports whether it validated the key; the server turns that
      // fact into a stored status. It cannot name the value itself.
      testStatus: testStatusForValidation(body.validated === true),
    });

    // Hide sensitive fields
    const result = { ...newConnection };
    delete result.apiKey;

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    console.error("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}

/**
 * PATCH /api/providers - one gesture, one request, for several connections.
 *
 * Every bulk action in the dashboard sent one request per connection: the usage
 * screen's activate/deactivate, and assigning a proxy pool to a whole provider.
 *
 * `isActive` is a plain column, so it is a single UPDATE. `proxyPoolId` lives
 * inside `providerSpecificData` and has to be merged per row, so the loop stays
 * — but on this side of the network, where it costs a query rather than a
 * round-trip from the browser.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { ids, isActive, proxyPoolId } = await request.json();
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "ids[] required" }, { status: 400 });
    }
    const setsActive = typeof isActive === "boolean";
    const setsProxy = proxyPoolId === null || typeof proxyPoolId === "string";
    if (!setsActive && !setsProxy) {
      return NextResponse.json({ error: "isActive or proxyPoolId required" }, { status: 400 });
    }
    if (ids.length === 0) return NextResponse.json({ success: true, updated: 0 });

    let updated = 0;
    if (setsActive) updated = await setProviderConnectionsActive(ids as string[], isActive);
    if (setsProxy) {
      const results = await Promise.all(
        (ids as string[]).map((id) => updateProviderConnection(id, { proxyPoolId } as never).catch(() => null)),
      );
      updated = results.filter(Boolean).length;
    }
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("Error updating providers:", error);
    return NextResponse.json({ error: "Failed to update providers" }, { status: 500 });
  }
}

/**
 * DELETE /api/providers - remove several connections in one request.
 *
 * The rows go one at a time on purpose: `deleteProviderConnection` also clears
 * the child rows that no foreign key covers, and doing that in a batch would
 * mean a second copy of the cascade. What this removes is N HTTP round-trips,
 * not N queries.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "ids[] required" }, { status: 400 });
    }
    let deleted = 0;
    for (const id of ids as string[]) {
      if (await deleteProviderConnection(id)) deleted += 1;
    }
    return NextResponse.json({ success: true, deleted, failed: ids.length - deleted });
  } catch (error) {
    console.error("Error deleting providers:", error);
    return NextResponse.json({ error: "Failed to delete providers" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
