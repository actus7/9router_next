import { getDefaultModel, resolveXiaomiTokenplanBaseUrl, PROVIDERS } from "@/server/llm-gateway/catalog";
import {
  CREDENTIAL_REJECTED_STATUSES,
  probeFailed,
  probeOk,
  verdictFromStatus,
  type ProbeResult,
} from "@/server/llm-gateway/probe/types";
import { providerValidateFetch } from "./providerValidateFetch";

const REJECTED_KEY = "Invalid API key";

export async function validateGlmFamily(provider: string, apiKey: string): Promise<ProbeResult> {
  // baseUrl comes from PROVIDERS; only the wire format differs per provider.
  const cfg = PROVIDERS[provider];
  const isOpenAiFormat = provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl" || provider === "alims-intl";

  if (isOpenAiFormat) {
    const res = await providerValidateFetch(cfg.baseUrl as string, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: getDefaultModel(provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    }, { providerId: provider });
    return verdictFromStatus(res.status, REJECTED_KEY);
  }

  const res = await providerValidateFetch(cfg.baseUrl as string, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(cfg.headers || {}),
    },
    body: JSON.stringify({
      model: getDefaultModel(provider) || "claude-sonnet-4-20250514",
      max_tokens: 1,
      messages: [{ role: "user", content: "test" }],
    }),
  }, { providerId: provider });
  // A 400 is a model resolution error with auth already passed, such as
  // agentrouter answering "no available channel".
  return verdictFromStatus(res.status, REJECTED_KEY);
}

export async function validateByConfigUrl(
  provider: string,
  apiKey: string,
  providerSpecificData: Record<string, unknown> | undefined,
): Promise<ProbeResult> {
  const endpoints: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(PROVIDERS).filter(([, t]) => t.validateUrl).map(([id, t]) => [id, t.validateUrl]),
    ),
    // Dynamic URL: depends on providerSpecificData, so it cannot live in the registry.
    "xiaomi-tokenplan": `${resolveXiaomiTokenplanBaseUrl({ providerSpecificData })}/models`,
  };
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await providerValidateFetch(endpoints[provider], { headers, signal: AbortSignal.timeout(8000) }, { providerId: provider });

  // Two providers answer off the common pattern and need their own reading.
  if (provider === "xai") {
    // 400 means a bad key; 403 means a valid key with no credit.
    const accepted = res.status === 200 || res.status === 403;
    return accepted ? probeOk({ status: res.status }) : probeFailed(REJECTED_KEY, { status: res.status });
  }
  if (provider === "xiaomi-tokenplan") {
    // /models answers 403 for a valid key without list permission.
    return res.status === 401
      ? probeFailed(REJECTED_KEY, { status: res.status })
      : probeOk({ status: res.status });
  }
  return res.ok ? probeOk({ status: res.status }) : probeFailed(REJECTED_KEY, { status: res.status });
}

export async function validateVertexKey(apiKey: string): Promise<ProbeResult> {
  const saJson = (() => {
    try {
      const parsed = JSON.parse(apiKey);
      return parsed.type === "service_account" ? parsed : null;
    } catch {
      return null;
    }
  })();

  if (saJson) {
    // A service-account JSON is checked for shape only: minting a token here
    // would cost a round trip for no extra certainty at save time.
    const complete = Boolean(saJson.client_email && saJson.private_key && saJson.project_id);
    return complete ? probeOk() : probeFailed("Service account JSON is missing required fields");
  }

  // Raw key: a 404 for the deliberately unknown model proves the key works.
  const res = await providerValidateFetch(
    `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    { providerId: "vertex" },
  );
  return verdictFromStatus(res.status, REJECTED_KEY);
}

export async function validateGenericOpenAiCompatible(provider: string, apiKey: string): Promise<ProbeResult> {
  const cfg = PROVIDERS[provider] as Record<string, unknown> | undefined;
  if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
    return probeFailed("Provider validation not supported", { configError: "missing-config" });
  }
  if (cfg.noAuth) return probeOk();

  const headers: Record<string, string> = { "Content-Type": "application/json", ...((cfg.headers as Record<string, string>) || {}) };
  if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
  else headers["Authorization"] = `Bearer ${apiKey}`;

  // A GET on /models is cheaper, so try it first and only fall back to a
  // minimal chat call when the answer is inconclusive.
  const modelsUrl = (cfg.baseUrl as string).replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
  try {
    const res = await providerValidateFetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) }, { providerId: provider });
    if (CREDENTIAL_REJECTED_STATUSES.has(res.status)) return probeFailed(REJECTED_KEY, { status: res.status });
    if (res.ok) return probeOk({ status: res.status });
  } catch { /* inconclusive: fall through to the chat probe */ }

  const chatRes = await providerValidateFetch(cfg.baseUrl as string, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: getDefaultModel(provider) || "test", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    signal: AbortSignal.timeout(10000),
  }, { providerId: provider });
  return verdictFromStatus(chatRes.status, REJECTED_KEY);
}
