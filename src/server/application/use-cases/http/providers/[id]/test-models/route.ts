import { NextRequest, NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "@/server/llm-gateway/catalog";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Compatible providers: fetch live model list
    if (isCompatible && models.length === 0) {
      try {
        const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          models = (data.models || []).map((m: { id?: string; name?: string }) => ({ id: m.id || m.name, name: m.name || m.id }));
        }
      } catch { /* fallback to empty */ }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    // This prevents race condition where multiple requests concurrently refresh the same token.
    const [first, ...rest] = models;
    const firstKind = String(first.kind || first.type || "llm");
    const firstResult = await pingModelByKind(`${alias}/${first.id}`, firstKind, baseUrl);
    const results = [{ modelId: first.id, name: String(first.name || first.id), ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model: Record<string, unknown>) => {
          const kind = String(model.kind || model.type || "llm");
          const result = await pingModelByKind(`${alias}/${String(model.id)}`, kind, baseUrl);
          return { modelId: model.id, name: String(model.name || model.id), ...result };
        })
      );
      results.push(...restResults);
    }

    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.error("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
