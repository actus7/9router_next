import { NextRequest, NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { PROVIDER_MODELS_CONFIG, fetchWithConnectionProxy } from "./providerModelsConfig";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (isOpenAICompatibleProvider(connection.provider)) {
      const baseUrl = connection.providerSpecificData?.baseUrl as string | undefined;
      if (!baseUrl) {
        return NextResponse.json({ error: "No base URL configured for OpenAI compatible provider" }, { status: 400 });
      }
      const url = `${baseUrl.replace(/\/$/, "")}/models`;
      const response = await fetchWithConnectionProxy(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${connection.apiKey}`,
        },
      }, connection.providerSpecificData as Record<string, unknown> | undefined);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error fetching models from ${connection.provider}:`, errorText);
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models
      });
    }

    if (isAnthropicCompatibleProvider(connection.provider)) {
      let baseUrl = connection.providerSpecificData?.baseUrl as string | undefined;
      if (!baseUrl) {
        return NextResponse.json({ error: "No base URL configured for Anthropic compatible provider" }, { status: 400 });
      }

      baseUrl = baseUrl.replace(/\/$/, "");
      if (baseUrl.endsWith("/messages")) {
        baseUrl = baseUrl.slice(0, -9);
      }

      const url = `${baseUrl}/models`;
      const response = await fetchWithConnectionProxy(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": connection.apiKey as string,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${connection.apiKey}`
        },
      }, connection.providerSpecificData as Record<string, unknown> | undefined);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error fetching models from ${connection.provider}:`, errorText);
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models
      });
    }

    // Connections created before canonical provider IDs were enforced can
    // still contain a UI alias (for example `naga`). Resolve it here at the
    // boundary so model discovery always uses the registry's canonical entry.
    const canonicalProviderId = normalizeProviderId(connection.provider as string);
    const config = PROVIDER_MODELS_CONFIG[canonicalProviderId];
    if (!config) {
      return NextResponse.json(
        { error: `Provider ${canonicalProviderId} does not support models listing` },
        { status: 400 }
      );
    }

    // Config-driven custom resolver path (OAuth refresh, non-OpenAI shape, etc.)
    if (typeof config.customResolver === "function") {
      const result = await config.customResolver(connection as unknown as Record<string, unknown>);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status || 500 });
      }
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models: result.models,
        ...(result.warning ? { warning: result.warning } : {})
      });
    }

    // Get auth token
    const token = connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
    if (!token) {
      return NextResponse.json({ error: "No valid token found" }, { status: 401 });
    }

    // Build request URL
    let url = config.url as string;
    if (canonicalProviderId === "ollama") {
      const configuredBaseUrl = connection.providerSpecificData?.baseUrl;
      const baseUrl = typeof configuredBaseUrl === "string" && configuredBaseUrl.trim()
        ? configuredBaseUrl.trim().replace(/\/$/, "")
        : "https://ollama.com";
      url = baseUrl.endsWith("/api/tags") ? baseUrl : `${baseUrl}/api/tags`;
    }
    if (config.authQuery) {
      url += `?${config.authQuery}=${token}`;
    }

    // Build headers
    const headers: Record<string, string> = { ...(config.headers as Record<string, string>) };
    if (config.authHeader && !config.authQuery) {
      headers[config.authHeader as string] = ((config.authPrefix as string) || "") + token;
    }

    // Make request
    const fetchOptions: RequestInit = {
      method: config.method as string,
      headers
    };

    if (config.body && config.method === "POST") {
      fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetchWithConnectionProxy(
      url,
      fetchOptions,
      connection.providerSpecificData as Record<string, unknown> | undefined,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching models from ${connection.provider}:`, errorText);
      return NextResponse.json(
        { error: `Failed to fetch models: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const models = (config.parseResponse as (data: unknown) => unknown[])(data);

    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models
    });
  } catch (error) {
    console.error("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
