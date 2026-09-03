import { NextResponse } from "next/server";
import { getDefaultModel, resolveXiaomiTokenplanBaseUrl, PROVIDERS } from "@/server/llm-gateway/catalog";
import { providerValidateFetch } from "./providerValidateFetch";

export async function validateGlmFamily(provider: string, apiKey: string): Promise<boolean> {
  // Use baseUrl from PROVIDERS (DRY); separate openai-format vs claude-format flow
  const cfg = PROVIDERS[provider];
  const isOpenAiFormat = provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl" || provider === "alims-intl";

  if (isOpenAiFormat) {
    const testModel = getDefaultModel(provider);
    const res = await providerValidateFetch(cfg.baseUrl as string, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    }, { providerId: provider });
    return res.status !== 401 && res.status !== 403;
  } else {
    const testModel = getDefaultModel(provider) || "claude-sonnet-4-20250514";
    const res = await providerValidateFetch(cfg.baseUrl as string, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(cfg.headers || {}),
      },
      body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    }, { providerId: provider });
    // 400 = model resolution error but auth passed (e.g. agentrouter "no available channel")
    return res.status !== 401 && res.status !== 403;
  }
}

export async function validateByConfigUrl(provider: string, apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<boolean> {
  const endpoints: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(PROVIDERS).filter(([, t]) => t.validateUrl).map(([id, t]) => [id, t.validateUrl])
    ),
    // dynamic URLs (depend on providerSpecificData) — kept inline
    "xiaomi-tokenplan": `${resolveXiaomiTokenplanBaseUrl({ providerSpecificData })}/models`,
  };
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await providerValidateFetch(endpoints[provider], { headers, signal: AbortSignal.timeout(8000) }, { providerId: provider });
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

export async function validateVertexKey(apiKey: string): Promise<boolean> {
  // Raw key: probe global endpoint (always 404 for unknown model, never 401)
  // SA JSON: attempt token mint via JWT assertion
  const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
  if (saJson) {
    // Validate SA JSON has required fields
    return !!(saJson.client_email && saJson.private_key && saJson.project_id);
  } else {
    // Raw key: probe Vertex — 404 means key is valid (model just doesn't exist), 401 means invalid key
    const probeRes = await providerValidateFetch(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      { providerId: "vertex" },
    );
    return probeRes.status !== 401 && probeRes.status !== 403;
  }
}

export async function validateGenericOpenAiCompatible(provider: string, apiKey: string): Promise<boolean | NextResponse> {
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
    const probeRes = await providerValidateFetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) }, { providerId: provider });
    if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
    else if (probeRes.ok) probeOk = true;
  } catch { /* fallback to chat */ }
  if (probeOk !== null) {
    return probeOk;
  }
  // Fallback: minimal chat probe
  const defaultModel = getDefaultModel(provider) || "test";
  const chatRes = await providerValidateFetch(cfg.baseUrl as string, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    signal: AbortSignal.timeout(10000),
  }, { providerId: provider });
  return chatRes.status !== 401 && chatRes.status !== 403;
}
