import { NextRequest, NextResponse } from "next/server";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { probeOk, type MaybeProbeResult, type ProbeResult } from "@/server/llm-gateway/probe/types";
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

/**
 * Ordered probe chain: the first stage that owns the provider answers.
 * Node-backed providers are matched by id prefix, two providers need
 * account-specific config, then the config-driven web and media probes get a
 * chance, and finally the per-provider table with its generic fallback.
 */
async function runProbeChain(
  provider: string,
  apiKey: string,
  providerSpecificData: Record<string, unknown> | undefined,
): Promise<ProbeResult> {
  if (isOpenAICompatibleProvider(provider)) return handleOpenAiCompatibleNode(provider, apiKey);
  if (isCustomEmbeddingProvider(provider)) return handleCustomEmbeddingNode(provider, apiKey);
  if (isAnthropicCompatibleProvider(provider)) return handleAnthropicCompatibleNode(provider, apiKey);
  if (provider === "cloudflare-ai") return handleCloudflareAi(apiKey, providerSpecificData);
  if (provider === "azure") return handleAzure(apiKey, providerSpecificData);

  const web: MaybeProbeResult = await probeWebProvider(provider, apiKey);
  if (web) return web;

  const media: MaybeProbeResult = await probeMediaProvider(provider, apiKey);
  if (media) return media;

  return validateProviderKey(provider, apiKey, providerSpecificData);
}

/** The one place a probe verdict becomes an HTTP response. */
function toResponse(result: ProbeResult): NextResponse {
  if (result.configError === "missing-node") {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (result.configError === "missing-config") {
    return NextResponse.json({ valid: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    valid: result.ok,
    error: result.ok ? null : (result.error || "Invalid API key"),
    ...(result.warning ? { warning: result.warning } : {}),
  });
}

// POST /api/providers/validate - Validate a credential with its provider
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(typeof body.providerId === "string" ? body.providerId : body.provider);
    const { apiKey, providerSpecificData } = body as ValidateBody;

    const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;
    if (!provider || (!apiKey && !isNoAuth)) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }
    if (isNoAuth && !apiKey) return toResponse(probeOk());

    try {
      return toResponse(await runProbeChain(provider, apiKey!, providerSpecificData));
    } catch (err) {
      // A thrown probe is inconclusive, not a hard failure of the endpoint.
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
