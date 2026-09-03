import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { getDefaultModel } from "@/server/llm-gateway/catalog";
import { providerValidateFetch } from "./providerValidateFetch";

export async function handleOpenAiCompatibleNode(provider: string, apiKey: string): Promise<NextResponse | null> {
  const node = await getProviderNodeById(provider);
  if (!node) {
    return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
  }
  const modelsUrl = `${(node.baseUrl as string)?.replace(/\/$/, "")}/models`;
  const res = await providerValidateFetch(modelsUrl, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  }, { providerId: provider });
  const isValid = res.ok;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key",
  });
}

export async function handleCustomEmbeddingNode(provider: string, apiKey: string): Promise<NextResponse | null> {
  const node = await getProviderNodeById(provider);
  if (!node) {
    return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
  }
  const baseUrl = (node.baseUrl as string)?.replace(/\/$/, "");
  const modelsRes = await providerValidateFetch(`${baseUrl}/models`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  }, { providerId: provider });
  if (modelsRes.ok) {
    return NextResponse.json({ valid: true });
  }
  // Auth errors are definitive
  if (modelsRes.status === 401 || modelsRes.status === 403) {
    return NextResponse.json({ valid: false, error: "Invalid API key" });
  }
  // Fallback: probe /embeddings with a common test model — many providers lack /models
  const embedRes = await providerValidateFetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "test", input: "ping" }),
  }, { providerId: provider });
  // 401/403 = bad key; anything else (including 400 "model not found") means key works
  const isValid = embedRes.status !== 401 && embedRes.status !== 403;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key",
  });
}

export async function handleAnthropicCompatibleNode(provider: string, apiKey: string): Promise<NextResponse | null> {
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

  const res = await providerValidateFetch(messagesUrl, {
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
  }, { providerId: provider });

  // 400/529 still confirms key accepted; only 401/403 = bad key
  const isValid = res.status !== 401 && res.status !== 403;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key",
  });
}

export async function handleCloudflareAi(apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<NextResponse> {
  const accountId = providerSpecificData?.accountId;
  if (!accountId) {
    return NextResponse.json({ valid: false, error: "Missing Account ID" });
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
  const cfRes = await providerValidateFetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getDefaultModel("cloudflare-ai"),
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1,
    }),
  }, { providerId: "cloudflare-ai" });
  const isValid = cfRes.status !== 401 && cfRes.status !== 403 && cfRes.status !== 404;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API token or Account ID",
  });
}

export async function handleAzure(apiKey: string, providerSpecificData: Record<string, unknown> | undefined): Promise<NextResponse> {
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

  const azureRes = await providerValidateFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1,
    }),
  }, { providerId: "azure" });
  const isValid = azureRes.status !== 401 && azureRes.status !== 403;
  return NextResponse.json({
    valid: isValid,
    error: isValid ? null : "Invalid API key or Azure configuration",
  });
}
