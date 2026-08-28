import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { OAUTH_ENDPOINTS, GEMINI_CLI_API_CLIENT, geminiCLIUserAgent } from "../config/appConstants";
import type { Credentials, Logger, RefreshResult } from "../services/types";

export class GeminiCLIExecutor extends BaseExecutor {
  _currentModel: string | null = null;

  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials: Credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel ?? undefined),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT ?? "",
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials) {
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = model;
    // Cloud Code Assist wraps the Gemini payload: { project, model, request: <body> }
    if (body && body.request && body.model) return body;
    return {
      project: credentials?.projectId || body?.project,
      model,
      request: body
    };
  }

  // Parse RetryInfo.retryDelay from Google API 429 body to surface upstream retry hint
  parseError(response: Response, bodyText: string) {
    const base = super.parseError(response, bodyText);
    if (response.status !== 429 || !bodyText) return base;
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      const details = (parsed?.error as Record<string, unknown>)?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          if (d && typeof d === "object" && (d as Record<string, unknown>)["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && (d as Record<string, unknown>).retryDelay) {
            return { ...base, retryAfter: (d as Record<string, unknown>).retryDelay };
          }
        }
      }
    } catch {}
    return base;
  }

  async refreshCredentials(credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token as string, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken as string,
          client_id: this.config.clientId as string,
          client_secret: this.config.clientSecret as string
        })
      });

      if (!response.ok) return null;

      const tokens = await response.json() as Record<string, unknown>;
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token as string,
        refreshToken: (tokens.refresh_token as string) || credentials.refreshToken,
        expiresIn: tokens.expires_in as number,
        projectId: credentials.projectId
      };
    } catch (e: unknown) {
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;
