import { getCloudUrl, getApiKeys } from "@/lib/db";

export type GatewayApiKey = { id: string; key: string; name?: string };

export async function resolveGatewayConfig(): Promise<{ gatewayApiUrl: string; apiKeys: GatewayApiKey[] }> {
  const [cloudUrl, apiKeys] = await Promise.all([getCloudUrl(), getApiKeys()]);
  const base = (cloudUrl || "").replace(/\/+$/, "");
  const gatewayApiUrl = base ? (/\/v1$/.test(base) ? base : `${base}/v1`) : "";
  return {
    gatewayApiUrl,
    apiKeys: apiKeys.map((k) => ({ id: k.id, key: k.key, name: k.name ?? undefined })),
  };
}
