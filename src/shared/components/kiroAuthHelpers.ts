"use client";

export interface IdcCredentials {
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: string;
  profileArn: string;
}

export interface AutoDetectResult {
  found: boolean;
  refreshToken?: string;
  error?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  authMethod?: string;
  profileArn?: string;
}

export async function autoDetectKiroToken(): Promise<AutoDetectResult> {
  const res = await fetch("/api/oauth/kiro/auto-import");
  return res.json();
}

export async function importKiroToken(
  refreshToken: string,
  idcCredentials: IdcCredentials | null,
): Promise<void> {
  const res = await fetch("/api/oauth/kiro/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshToken.trim(), ...(idcCredentials || {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Import failed");
}

export async function importKiroCliProxyJson(json: string): Promise<void> {
  const res = await fetch("/api/oauth/kiro/import-cli-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: json.trim() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "CLIProxyAPI import failed");
}

export async function importKiroApiKey(
  apiKey: string,
  region: string,
): Promise<void> {
  const res = await fetch("/api/oauth/kiro/api-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: apiKey.trim(), region: region.trim() || "us-east-1" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Import failed");
}
