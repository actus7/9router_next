import { NextRequest, NextResponse } from "next/server";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { probeMediaProvider, probeWebProvider } from "./validateProbes";
import {
  handleAnthropicCompatibleNode,
  handleAzure,
  handleCloudflareAi,
  handleCustomEmbeddingNode,
  handleOpenAiCompatibleNode,
} from "./validateSpecialHandlers";
import { validateProviderKey } from "./validateProviderKey";

type ValidateBody = { apiKey?: string; providerSpecificData?: Record<string, unknown> };

// POST /api/providers/validate - Validate API key with provider
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(typeof body.providerId === "string" ? body.providerId : body.provider);
    const { apiKey, providerSpecificData } = body as ValidateBody;

    const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;
    if (!provider || (!apiKey && !isNoAuth)) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    // Validate with each provider
    try {
      // Node-backed special cases return their own response
      if (isOpenAICompatibleProvider(provider)) {
        return (await handleOpenAiCompatibleNode(provider, apiKey!))!;
      }

      // Custom Embedding nodes: probe /models (most embedding APIs are OpenAI-compatible)
      if (isCustomEmbeddingProvider(provider)) {
        return (await handleCustomEmbeddingNode(provider, apiKey!))!;
      }

      if (isAnthropicCompatibleProvider(provider)) {
        return (await handleAnthropicCompatibleNode(provider, apiKey!))!;
      }

      if (provider === "cloudflare-ai") {
        return await handleCloudflareAi(apiKey!, providerSpecificData);
      }

      if (provider === "azure") {
        return await handleAzure(apiKey!, providerSpecificData);
      }

      // Generic probe for webSearch/webFetch providers (config-driven)
      const webResult = await probeWebProvider(provider, apiKey!);
      if (webResult !== null) {
        return NextResponse.json({
          valid: webResult,
          error: webResult ? null : "Invalid API key",
        });
      }

      // Generic probe for tts/embedding providers (config-driven)
      const mediaResult = await probeMediaProvider(provider, apiKey!);
      if (mediaResult !== null) {
        return NextResponse.json({
          valid: mediaResult,
          error: mediaResult ? null : "Invalid API key",
        });
      }

      const result = await validateProviderKey(provider, apiKey!, providerSpecificData);
      if (result instanceof NextResponse) return result;
      return NextResponse.json({
        valid: result.isValid,
        error: result.isValid ? null : (result.error || "Invalid API key"),
      });
    } catch (err) {
      return NextResponse.json({
        valid: false,
        error: (err as Error).message || "Invalid API key",
      });
    }
  } catch (error) {
    console.error("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
