// Host adapter — OAuth refresh helpers (kiro external IdP params, xAI token
// refresh service, kiro profile ARN resolution).
//
// Dynamic imports are preserved (and centralized here) so the OAuth provider
// graph is only loaded when one of these providers is actually refreshed.
export { buildExternalIdpRefreshParams } from "@/lib/oauth/kiroExternalIdp";

export interface XaiRefreshService {
  refreshAccessToken(token: string): Promise<Record<string, unknown>>;
}

let _xaiServiceSingleton: XaiRefreshService | null = null;

/** Lazily resolve the host xAI OAuth service (cached singleton). */
export async function getXaiRefreshService(): Promise<XaiRefreshService> {
  if (!_xaiServiceSingleton) {
    const mod = (await import("@/lib/oauth/services/xai")) as {
      XaiService: new () => XaiRefreshService;
    };
    _xaiServiceSingleton = new mod.XaiService();
  }
  return _xaiServiceSingleton;
}

/** Resolve the Kiro profile ARN via the host OAuth helpers. */
export async function fetchKiroProfileArn(accessToken: string): Promise<string | null> {
  const mod = (await import("@/lib/oauth/providerHelpers")) as {
    fetchKiroProfileArn: (token: string) => Promise<string | null>;
  };
  return mod.fetchKiroProfileArn(accessToken);
}
