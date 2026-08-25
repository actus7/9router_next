const BASE64_BLOCK_SIZE: number = 4;

function validateXaiOAuthEndpoint(rawUrl: string, field: string): string {
  const value: string = String(rawUrl || "").trim();
  if (!value) throw new Error(`xai discovery ${field} is empty`);
  let parsed: URL;
  try { parsed = new URL(value); } catch (err: unknown) {
    throw new Error(`xai discovery ${field} is invalid: ${(err as Error).message}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`xai discovery ${field} must use https: ${value}`);
  const host: string = parsed.hostname.toLowerCase().trim();
  if (host !== "x.ai" && !host.endsWith(".x.ai")) {
    throw new Error(`xai discovery ${field} host ${host} is not on x.ai`);
  }
  return value;
}

function decodeXaiIdTokenEmail(idToken: string): string | undefined {
  if (!idToken || typeof idToken !== "string") return undefined;
  const parts: string[] = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const base64: string = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding: number = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const json: string = Buffer.from(base64 + "=".repeat(padding), "base64").toString("utf8");
    const payload: Record<string, unknown> = JSON.parse(json);
    return (payload.email as string) || (payload.preferred_username as string) || (payload.sub as string) || undefined;
  } catch {
    return undefined;
  }
}

interface JwtPayload {
  email?: string;
  preferred_username?: string;
  sub?: string;
  account_id?: string;
  plan_type?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
  [key: string]: unknown;
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts: string[] = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64: string = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding: number = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const padded: string = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractEmailFromAccessToken(accessToken: string): string | undefined {
  const payload: JwtPayload | null = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  return payload.email || payload.preferred_username || payload.sub || undefined;
}

interface KiroProfile {
  arn?: string;
  [key: string]: unknown;
}

export async function fetchKiroProfileArn(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const response: Response = await fetch("https://codewhisperer.us-east-1.amazonaws.com/ListAvailableProfiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ maxResults: 10 }),
    });
    if (!response.ok) return null;
    const data: { profiles?: KiroProfile[] } = await response.json();
    return data.profiles?.find((p: KiroProfile) => p.arn?.trim())?.arn?.trim() || null;
  } catch {
    return null;
  }
}

interface CodexAccountInfo {
  email?: string;
  chatgptAccountId?: string;
  chatgptPlanType?: string;
}

export function extractCodexAccountInfo(idToken: string): CodexAccountInfo {
  const payload: JwtPayload | null = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt = (payload["https://api.openai.com/auth"] as Record<string, unknown>) || {};
  return {
    email: payload.email,
    chatgptAccountId: (chatgpt.chatgpt_account_id as string) || (payload.account_id as string),
    chatgptPlanType: (chatgpt.chatgpt_plan_type as string) || (payload.plan_type as string),
  };
}

export {
  BASE64_BLOCK_SIZE,
  validateXaiOAuthEndpoint,
  decodeXaiIdTokenEmail,
  decodeJwtPayload,
  extractEmailFromAccessToken,
};
