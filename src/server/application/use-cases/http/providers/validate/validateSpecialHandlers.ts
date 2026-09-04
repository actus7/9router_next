import { getProviderNodeById } from "@/models";
import { getDefaultModel } from "@/server/llm-gateway/catalog";
import { probeFailed, probeOk, type ProbeResult } from "@/server/llm-gateway/probe/types";
import { providerValidateFetch } from "./providerValidateFetch";

// 401 and 403 mean the credential was rejected. Everything else, including a
// 400 for an unknown test model, means the credential was accepted.
const REJECTED: ReadonlySet<number> = new Set([401, 403]);

function verdictFromStatus(status: number, error: string, rejected: ReadonlySet<number> = REJECTED): ProbeResult {
  return rejected.has(status) ? probeFailed(error, { status }) : probeOk({ status });
}

function missingNode(label: string): ProbeResult {
  return probeFailed(`${label} node not found`, { configError: "missing-node" });
}

export async function handleOpenAiCompatibleNode(provider: string, apiKey: string): Promise<ProbeResult> {
  const node = await getProviderNodeById(provider);
  if (!node) return missingNode("OpenAI Compatible");

  const modelsUrl = `${(node.baseUrl as string)?.replace(/\/$/, "")}/models`;
  const res = await providerValidateFetch(modelsUrl, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  }, { providerId: provider });
  return res.ok ? probeOk({ status: res.status }) : probeFailed("Invalid API key", { status: res.status });
}

export async function handleCustomEmbeddingNode(provider: string, apiKey: string): Promise<ProbeResult> {
  const node = await getProviderNodeById(provider);
  if (!node) return missingNode("Custom Embedding");

  const baseUrl = (node.baseUrl as string)?.replace(/\/$/, "");
  const modelsRes = await providerValidateFetch(`${baseUrl}/models`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  }, { providerId: provider });
  if (modelsRes.ok) return probeOk({ status: modelsRes.status });
  if (REJECTED.has(modelsRes.status)) return probeFailed("Invalid API key", { status: modelsRes.status });

  // Many embedding APIs have no /models, so fall back to a real embedding call.
  const embedRes = await providerValidateFetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "test", input: "ping" }),
  }, { providerId: provider });
  return verdictFromStatus(embedRes.status, "Invalid API key");
}

export async function handleAnthropicCompatibleNode(provider: string, apiKey: string): Promise<ProbeResult> {
  const node = await getProviderNodeById(provider);
  if (!node) return missingNode("Anthropic Compatible");

  let normalizedBase = (node.baseUrl as string)?.trim().replace(/\/$/, "") || "";
  if (normalizedBase.endsWith("/messages")) {
    normalizedBase = normalizedBase.slice(0, -"/messages".length);
  }

  const res = await providerValidateFetch(`${normalizedBase}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: node.defaultModel || "claude-3-haiku-20240307",
      max_tokens: 1,
      messages: [{ role: "user", content: "test" }],
    }),
  }, { providerId: provider });

  // A 400 or 529 still confirms the key was accepted.
  return verdictFromStatus(res.status, "Invalid API key");
}

export async function handleCloudflareAi(apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<ProbeResult> {
  const accountId = providerSpecificData?.accountId;
  if (!accountId) return probeFailed("Missing Account ID", { configError: "missing-config" });

  const res = await providerValidateFetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getDefaultModel("cloudflare-ai"),
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1,
      }),
    },
    { providerId: "cloudflare-ai" },
  );
  // A 404 here means the account id is wrong, not that the token is.
  return verdictFromStatus(res.status, "Invalid API token or Account ID", new Set([401, 403, 404]));
}

export async function handleAzure(apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<ProbeResult> {
  const endpoint = ((providerSpecificData?.azureEndpoint as string) || "").replace(/\/$/, "");
  const deployment = providerSpecificData?.deployment || "gpt-4";
  const apiVersion = providerSpecificData?.apiVersion || "2024-10-01-preview";
  const organization = providerSpecificData?.organization;

  const headers: Record<string, string> = {
    "api-key": apiKey,
    "Content-Type": "application/json",
  };
  if (organization) headers["OpenAI-Organization"] = organization as string;

  const res = await providerValidateFetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }], max_tokens: 1 }),
    },
    { providerId: "azure" },
  );
  return verdictFromStatus(res.status, "Invalid API key or Azure configuration");
}
