import { NextRequest, NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { getDefaultModel, resolveXiaomiTokenplanBaseUrl, PROVIDERS, resolveQoderCredentials, resolveQoderModels } from "@/server/llm-gateway/catalog";
import { openaiToCommandCodeRequest } from "@/server/llm-gateway/translator";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { safePublicFetch } from "@/server/security/safeFetch";

type ValidateBody = { apiKey?: string; providerSpecificData?: Record<string, unknown> };

// Probe a webSearch/webFetch provider using its searchConfig/fetchConfig.
// Returns true if API key is accepted (status !== 401 && !== 403).
async function probeWebProvider(provider: string, apiKey: string): Promise<boolean | null> {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  // Skip if provider has dual-purpose (LLM + search), let LLM validate handle it
  const kinds = p.serviceKinds || ["llm"];
  const isWebOnly = (kinds as string[]).every((k: string) => k === "webSearch" || k === "webFetch");
  if (!isWebOnly) return null;
  const cfg = (p.searchConfig || p.fetchConfig) as Record<string, unknown> | undefined;
  if (!cfg) return null;
  if (cfg.authType === "none") return true; // no-auth (e.g. searxng)

  let url = cfg.baseUrl as string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string | undefined;

  // Apply auth based on authHeader
  switch (cfg.authHeader as string) {
    case "bearer":              headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "x-api-key":           headers["x-api-key"] = apiKey; break;
    case "x-subscription-token":headers["x-subscription-token"] = apiKey; break;
    case "key":                 url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`; break; // google-pse
    case "api_key":             url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`; break; // searchapi
  }

  // Minimal body for POST endpoints; GET sends nothing
  if (cfg.method === "POST") {
    body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });
  }

  const res = await fetch(url, { method: cfg.method as string, headers, body, signal: AbortSignal.timeout(8000) });
  return res.status !== 401 && res.status !== 403;
}

// Probe a media provider (tts/embedding/stt/image/video) using *Config.
// Returns true if API key is accepted; null to skip (let default handler decide).
async function probeMediaProvider(provider: string, apiKey: string): Promise<boolean | null> {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const MEDIA_KINDS = new Set(["tts", "embedding", "stt", "image", "video", "music", "imageToText"]);
  const kinds = p.serviceKinds || ["llm"];
  const isMediaOnly = (kinds as string[]).every((k: string) => MEDIA_KINDS.has(k));
  if (!isMediaOnly) return null;
  const cfg = (p.ttsConfig || p.sttConfig || p.embeddingConfig || p.imageConfig || p.videoConfig || p.musicConfig) as Record<string, unknown> | undefined;
  // No probe config → best-effort accept (validate at usage time)
  if (!cfg) return true;
  if (p.noAuth || cfg.authType === "none") return true;
  // Skip auth schemes that need provider-specific data
  if (cfg.authHeader === "playht" || cfg.authHeader === "aws-sigv4") return true;

  const headers: Record<string, string> = { "Content-Type": "application/json", ...((cfg.extraHeaders as Record<string, string>) || {}) };

  switch (cfg.authHeader as string) {
    case "bearer":     headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "key":        headers["Authorization"] = `Key ${apiKey}`; break;
    case "x-api-key":  headers["x-api-key"] = apiKey; break;
    case "x-key":      headers["x-key"] = apiKey; break;
    case "xi-api-key": headers["xi-api-key"] = apiKey; break;
    case "token":      headers["Authorization"] = `Token ${apiKey}`; break;
    case "basic":      headers["Authorization"] = `Basic ${apiKey}`; break;
    default: return null;
  }

  const method = (cfg.method as string) || "POST";
  const res = await fetch(cfg.baseUrl as string, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ input: "ping", text: "ping", prompt: "ping", model: getDefaultModel(provider) || "test" }),
    signal: AbortSignal.timeout(8000),
  });
  return res.status !== 401 && res.status !== 403;
}

// ─── Special handlers (early-return with their own NextResponse) ───────────

async function handleOpenAiCompatibleNode(provider: string, apiKey: string): Promise<NextResponse | null> {
  const node = await getProviderNodeById(provider);
  if (!node) {
    return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
  }
  const modelsUrl = `${(node.baseUrl as string)?.replace(/\/$/, "")}/models`;
  const res = await safePublicFetch(modelsUrl, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const isValid = res.ok;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key",
  });
}

async function handleCustomEmbeddingNode(provider: string, apiKey: string): Promise<NextResponse | null> {
  const node = await getProviderNodeById(provider);
  if (!node) {
    return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
  }
  const baseUrl = (node.baseUrl as string)?.replace(/\/$/, "");
  const modelsRes = await safePublicFetch(`${baseUrl}/models`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (modelsRes.ok) {
    return NextResponse.json({ valid: true });
  }
  // Auth errors are definitive
  if (modelsRes.status === 401 || modelsRes.status === 403) {
    return NextResponse.json({ valid: false, error: "Invalid API key" });
  }
  // Fallback: probe /embeddings with a common test model — many providers lack /models
  const embedRes = await safePublicFetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "test", input: "ping" }),
  });
  // 401/403 = bad key; anything else (including 400 "model not found") means key works
  const isValid = embedRes.status !== 401 && embedRes.status !== 403;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key",
  });
}

async function handleAnthropicCompatibleNode(provider: string, apiKey: string): Promise<NextResponse | null> {
  const node = await getProviderNodeById(provider);
  if (!node) {
    return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
  }

  let normalizedBase = (node.baseUrl as string)?.trim().replace(/\/$/, "") || "";
  if (normalizedBase.endsWith("/messages")) {
    normalizedBase = normalizedBase.slice(0, -9); // remove /messages
  }

  const messagesUrl = `${normalizedBase}/v1/messages`;
  const model = node.defaultModel || "claude-3-haiku-20240307";

  const res = await safePublicFetch(messagesUrl, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "test" }],
    }),
  });

  // 400/529 still confirms key accepted; only 401/403 = bad key
  const isValid = res.status !== 401 && res.status !== 403;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key",
  });
}

async function handleCloudflareAi(apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<NextResponse> {
  const accountId = providerSpecificData?.accountId;
  if (!accountId) {
    return NextResponse.json({ valid: false, error: "Missing Account ID" });
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
  const cfRes = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getDefaultModel("cloudflare-ai"),
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1,
    }),
  });
  const isValid = cfRes.status !== 401 && cfRes.status !== 403 && cfRes.status !== 404;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API token or Account ID",
  });
}

async function handleAzure(apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<NextResponse> {
  const endpoint = ((providerSpecificData?.azureEndpoint as string) || "").replace(/\/$/, "");
  const deployment = providerSpecificData?.deployment || "gpt-4";
  const apiVersion = providerSpecificData?.apiVersion || "2024-10-01-preview";
  const organization = providerSpecificData?.organization;

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const headers: Record<string, string> = {
    "api-key": apiKey,
    "Content-Type": "application/json",
  };
  if (organization) headers["OpenAI-Organization"] = organization as string;

  const azureRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1,
    }),
  });
  const isValid = azureRes.status !== 401 && azureRes.status !== 403;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key or Azure configuration",
  });
}

// ─── Per-family validators (return boolean; throw to set error) ────────────

async function validateGlmFamily(provider: string, apiKey: string): Promise<boolean> {
  // Use baseUrl from PROVIDERS (DRY); separate openai-format vs claude-format flow
  const cfg = PROVIDERS[provider];
  const isOpenAiFormat = provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl" || provider === "alims-intl";

  if (isOpenAiFormat) {
    const testModel = getDefaultModel(provider);
    const res = await fetch(cfg.baseUrl as string, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    });
    return res.status !== 401 && res.status !== 403;
  } else {
    const testModel = getDefaultModel(provider) || "claude-sonnet-4-20250514";
    const res = await fetch(cfg.baseUrl as string, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(cfg.headers || {}),
      },
      body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    });
    // 400 = model resolution error but auth passed (e.g. agentrouter "no available channel")
    return res.status !== 401 && res.status !== 403;
  }
}

async function validateByConfigUrl(provider: string, apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<boolean> {
  const endpoints: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(PROVIDERS).filter(([, t]) => t.validateUrl).map(([id, t]) => [id, t.validateUrl])
    ),
    // dynamic URLs (depend on providerSpecificData) — kept inline
    "xiaomi-tokenplan": `${resolveXiaomiTokenplanBaseUrl({ providerSpecificData })}/models`,
  };
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(endpoints[provider], { headers, signal: AbortSignal.timeout(8000) });
  // xai returns 400 for bad key, 403 for valid-but-no-credit. Other providers use 401.
  if (provider === "xai") {
    return res.status === 200 || res.status === 403;
  } else if (provider === "xiaomi-tokenplan") {
    // /models returns 403 for valid keys lacking list permission; only 401 means invalid
    return res.status !== 401;
  } else {
    return res.ok;
  }
}

async function validateVertexKey(apiKey: string): Promise<boolean> {
  // Raw key: probe global endpoint (always 404 for unknown model, never 401)
  // SA JSON: attempt token mint via JWT assertion
  const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
  if (saJson) {
    // Validate SA JSON has required fields
    return !!(saJson.client_email && saJson.private_key && saJson.project_id);
  } else {
    // Raw key: probe Vertex — 404 means key is valid (model just doesn't exist), 401 means invalid key
    const probeRes = await fetch(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    );
    return probeRes.status !== 401 && probeRes.status !== 403;
  }
}

async function validateGenericOpenAiCompatible(provider: string, apiKey: string): Promise<boolean | NextResponse> {
  // Generic probe for OpenAI-compatible providers (config-driven from PROVIDERS)
  const cfg = PROVIDERS[provider] as Record<string, unknown> | undefined;
  if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
    return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
  }
  if (cfg.noAuth) {
    return true;
  }
  // Build auth headers based on cfg.authHeader (default: bearer)
  const headers: Record<string, string> = { "Content-Type": "application/json", ...((cfg.headers as Record<string, string>) || {}) };
  if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
  else headers["Authorization"] = `Bearer ${apiKey}`;
  // Try /models first (fast GET), fallback to chat probe on ambiguous response
  const modelsUrl = (cfg.baseUrl as string).replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
  let probeOk: boolean | null = null;
  try {
    const probeRes = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
    else if (probeRes.ok) probeOk = true;
  } catch { /* fallback to chat */ }
  if (probeOk !== null) {
    return probeOk;
  }
  // Fallback: minimal chat probe
  const defaultModel = getDefaultModel(provider) || "test";
  const chatRes = await fetch(cfg.baseUrl as string, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    signal: AbortSignal.timeout(10000),
  });
  return chatRes.status !== 401 && chatRes.status !== 403;
}

// ─── Provider switch dispatch (mirrors the original switch verbatim) ───────

async function validateProviderKey(provider: string, apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<{ isValid: boolean; error: string | null } | NextResponse> {
  switch (provider) {
    case "openai": {
      const openaiRes = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      return { isValid: openaiRes.ok, error: null };
    }

    case "vercel-ai-gateway": {
      const vercelAiGatewayRes = await fetch("https://ai-gateway.vercel.sh/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      return { isValid: vercelAiGatewayRes.ok, error: null };
    }

    case "anthropic": {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      });
      return { isValid: anthropicRes.status !== 401, error: null };
    }

    case "gemini": {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
      return { isValid: geminiRes.ok, error: null };
    }

    case "openrouter": {
      const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      return { isValid: openrouterRes.ok, error: null };
    }

    case "glm":
    case "glm-cn":
    case "kimi":
    case "minimax":
    case "minimax-cn":
    case "alicode-intl":
    case "alims-intl":
    case "alicode":
    case "agentrouter":
      return { isValid: await validateGlmFamily(provider, apiKey), error: null };

    case "volcengine-ark":
    case "byteplus": {
      const res = await fetch(PROVIDERS[provider]?.baseUrl as string, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: getDefaultModel(provider),
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      });
      return { isValid: res.status !== 401 && res.status !== 403, error: null };
    }

    case "deepseek":
    case "groq":
    case "xai":
    case "mistral":
    case "perplexity":
    case "together":
    case "fireworks":
    case "cerebras":
    case "cohere":
    case "nebius":
    case "siliconflow":
    case "hyperbolic":
    case "ollama":
    case "assemblyai":
    case "nanobanana":
    case "chutes":
    case "xiaomi-mimo":
    case "xiaomi-tokenplan":
    case "nvidia":
      return { isValid: await validateByConfigUrl(provider, apiKey, providerSpecificData), error: null };

    case "opencode-go": {
      const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: getDefaultModel("opencode-go"),
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
      });
      return { isValid: res.status !== 401 && res.status !== 403, error: null };
    }

    case "commandcode": {
      const cfg = PROVIDERS.commandcode;
      const model = getDefaultModel("commandcode");
      const payload = openaiToCommandCodeRequest(model as string, {
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }, false);
      const res = await fetch(cfg.baseUrl as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.headers || {}),
          "x-session-id": crypto.randomUUID(),
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      return { isValid: res.status !== 401 && res.status !== 403, error: null };
    }

    case "deepgram": {
      const res = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { "Authorization": `Token ${apiKey}` },
      });
      return { isValid: res.ok, error: null };
    }

    case "blackbox": {
      const res = await fetch("https://api.blackbox.ai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 10,
        }),
      });
      // Returns 401 for invalid key, 200 for valid, 400 for malformed
      return { isValid: res.status === 200 || res.status === 400, error: null };
    }

    case "vertex":
    case "vertex-partner":
      return { isValid: await validateVertexKey(apiKey), error: null };

    case "qoder": {
      // PAT (pt-...) needs the job-token exchange before it can sign
      // anything — the generic OpenAI-compat probe below can't validate it.
      try {
        const resolved = await resolveQoderCredentials({ apiKey, providerSpecificData }, null, AbortSignal.timeout(8000));
        const result = await resolveQoderModels(resolved, { forceRefresh: true });
        return { isValid: !!result?.models?.length, error: null };
      } catch (err) {
        return { isValid: false, error: (err as Error).message };
      }
    }

    default: {
      const generic = await validateGenericOpenAiCompatible(provider, apiKey);
      if (generic instanceof NextResponse) return generic;
      return { isValid: generic, error: null };
    }
  }
}

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
