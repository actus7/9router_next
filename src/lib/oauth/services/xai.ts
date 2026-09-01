import { XAI_CONFIG } from "../constants/xai";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  [key: string]: unknown;
}

let cachedTokenUrl: string | null = null;

function validateTokenEndpoint(rawUrl: string): string {
  const parsed = new URL(String(rawUrl || "").trim());
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || (hostname !== "x.ai" && !hostname.endsWith(".x.ai"))) {
    throw new Error("xAI token endpoint must use HTTPS on x.ai");
  }
  return parsed.href;
}

async function discoverTokenUrl(): Promise<string> {
  if (cachedTokenUrl) return cachedTokenUrl;
  const config = XAI_CONFIG as unknown as Record<string, string>;
  try {
    const response = await fetch(config.discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const discovery = await response.json() as { token_endpoint?: string };
      cachedTokenUrl = validateTokenEndpoint(discovery.token_endpoint ?? "");
      return cachedTokenUrl;
    }
  } catch {
    // The pinned xAI endpoint below is the offline fallback.
  }
  cachedTokenUrl = validateTokenEndpoint(config.tokenUrl);
  return cachedTokenUrl;
}

export class XaiService {
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const tokenUrl = await discoverTokenUrl();
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: (XAI_CONFIG as unknown as Record<string, string>).clientId,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`xAI token refresh failed: ${(await response.text()).slice(0, 500)}`);
    }
    return response.json() as Promise<TokenResponse>;
  }
}
