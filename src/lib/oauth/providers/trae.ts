import crypto from "crypto";
import { TRAE_CONFIG } from "../constants/oauth";
import { extractJsonPath } from "./_shared";

interface TraeDeviceContext {
  plugin_version: string;
  machine_id: string;
  device_id: string;
  x_device_brand: string;
  x_device_type: string;
  x_os_version: string;
  x_env: string;
  x_app_version: string;
  x_app_type: string;
}

function buildTraeDeviceContext(): TraeDeviceContext {
  return {
    plugin_version: (TRAE_CONFIG as Record<string, string>).defaultPluginVersion,
    machine_id: crypto.randomUUID(),
    device_id: (TRAE_CONFIG as Record<string, string>).defaultDeviceId,
    x_device_brand: "unknown",
    x_device_type: "unknown",
    x_os_version: "unknown",
    x_env: "",
    x_app_version: (TRAE_CONFIG as Record<string, string>).defaultAppVersion,
    x_app_type: (TRAE_CONFIG as Record<string, string>).defaultAppType,
  };
}

async function fetchTraeLoginGuidance(loginTraceId: string): Promise<string> {
  const body: string = JSON.stringify({ loginTraceID: loginTraceId, login_trace_id: loginTraceId });
  let lastErr: string = "no successful response";
  for (const url of (TRAE_CONFIG as Record<string, string[]>).loginGuidanceUrls) {
    try {
      const res: Response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": (TRAE_CONFIG as Record<string, string>).userAgent,
        },
        body,
      });
      if (!res.ok) { lastErr = `${url} HTTP ${res.status}`; continue; }
      const data: Record<string, unknown> = await res.json();
      const loginHost: string | null = extractJsonPath(data, [
        ["Result", "LoginHost"], ["Result", "loginHost"], ["Result", "LoginURL"],
        ["result", "loginHost"], ["data", "Result", "LoginHost"], ["data", "loginHost"],
        ["LoginHost"], ["loginHost"],
      ]);
      if (loginHost) return loginHost;
      lastErr = `${url} missing LoginHost`;
    } catch (e: unknown) { lastErr = `${url} ${(e as Error).message}`; }
  }
  throw new Error(`Trae GetLoginGuidance failed: ${lastErr}`);
}

function buildTraeVerificationUrl(loginHost: string, loginTraceId: string, callbackUrl: string, ctx: TraeDeviceContext): string {
  const url: URL = new URL(loginHost.startsWith("http") ? loginHost : `https://${loginHost.replace(/^\/+/, "")}`);
  url.pathname = (TRAE_CONFIG as Record<string, string>).authorizationPath;
  const p: URLSearchParams = new URLSearchParams();
  p.set("login_version", "1");
  p.set("auth_from", "trae");
  p.set("login_channel", "native_ide");
  p.set("plugin_version", ctx.plugin_version);
  p.set("auth_type", "local");
  p.set("client_id", (TRAE_CONFIG as Record<string, string>).clientId);
  p.set("redirect", "0");
  p.set("login_trace_id", loginTraceId);
  p.set("auth_callback_url", callbackUrl);
  p.set("machine_id", ctx.machine_id);
  p.set("device_id", ctx.device_id);
  p.set("x_device_id", ctx.device_id);
  p.set("x_machine_id", ctx.machine_id);
  p.set("x_device_brand", ctx.x_device_brand);
  p.set("x_device_type", ctx.x_device_type);
  p.set("x_os_version", ctx.x_os_version);
  p.set("x_env", ctx.x_env);
  p.set("x_app_version", ctx.x_app_version);
  p.set("x_app_type", ctx.x_app_type);
  url.search = p.toString();
  return url.toString();
}

interface TraeCallbackResult {
  refreshToken: string;
  loginHost: string;
  cloudideToken: string | null;
}

function parseTraeCallback(raw: string): TraeCallbackResult {
  const text: string = String(raw || "").trim();
  let queryStr: string = text;
  if (text.includes("?")) queryStr = text.slice(text.indexOf("?") + 1);
  if (text.startsWith("#")) queryStr = text.slice(1);
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(queryStr));
  const pick = (keys: string[]): string | null => {
    for (const k of keys) { const v: string = params[k]; if (v && String(v).trim()) return String(v).trim(); }
    return null;
  };
  const err: string | null = pick(["error", "error_code", "errorCode"]);
  if (err) {
    const desc: string | null = pick(["error_description", "error_desc", "message"]);
    throw new Error(desc ? `Trae auth failed: ${err} (${desc})` : `Trae auth failed: ${err}`);
  }
  const refreshToken: string | null = pick(["refreshToken", "refresh_token", "RefreshToken"]);
  if (!refreshToken) throw new Error("Trae callback missing refreshToken");
  const loginHost: string | null = pick(["loginHost", "login_host", "LoginHost", "host", "consoleHost"]);
  if (!loginHost) throw new Error("Trae callback missing loginHost");
  const cloudideToken: string | null = pick(["x-cloudide-token", "xCloudideToken", "accessToken", "access_token", "token"]);
  return { refreshToken, loginHost, cloudideToken };
}

function traeApiOrigins(): string[] {
  return [...(TRAE_CONFIG as Record<string, string[]>).apiOrigins];
}

interface TraeExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: null;
  expiresAt: string | null;
}

async function fetchTraeExchangeToken(refreshToken: string, cloudideToken: string | null): Promise<TraeExchangeResult> {
  const body: string = JSON.stringify({
    ClientID: (TRAE_CONFIG as Record<string, string>).clientId,
    RefreshToken: refreshToken,
    ClientSecret: (TRAE_CONFIG as Record<string, string>).clientSecret,
    UserID: "",
  });
  let lastErr: string = "no successful response";
  for (const origin of traeApiOrigins()) {
    const url: string = `${origin.replace(/\/$/, "")}${(TRAE_CONFIG as Record<string, string>).exchangeTokenPath}`;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": (TRAE_CONFIG as Record<string, string>).userAgent,
      };
      if (cloudideToken) headers["x-cloudide-token"] = cloudideToken;
      const res: Response = await fetch(url, { method: "POST", headers, body });
      const text: string = await res.text();
      if (!res.ok) { lastErr = `${url} HTTP ${res.status}`; continue; }
      let data: Record<string, unknown>; try { data = JSON.parse(text); } catch { lastErr = `${url} invalid JSON`; continue; }
      const accessToken: string | null = extractJsonPath(data, [
        ["Result", "AccessToken"], ["Result", "accessToken"], ["result", "access_token"], ["accessToken"],
      ]);
      if (!accessToken) {
        const msg: string = extractJsonPath(data, [["message"], ["msg"], ["error"], ["Result", "Message"]]) || "missing AccessToken";
        lastErr = `${url} ${msg}`;
        continue;
      }
      return {
        accessToken,
        refreshToken: extractJsonPath(data, [["Result", "RefreshToken"], ["result", "refresh_token"], ["refreshToken"]]) || refreshToken,
        expiresIn: null,
        expiresAt: extractJsonPath(data, [["Result", "ExpiresAt"], ["Result", "expiresAt"], ["result", "expires_at"], ["expiresAt"]]),
      };
    } catch (e: unknown) { lastErr = `${url} ${(e as Error).message}`; }
  }
  throw new Error(`Trae ExchangeToken failed: ${lastErr}`);
}

interface TraeUserInfo {
  email: string | null;
  name: string | null;
  aiRegion: string | null;
  region: string | null;
  tenant: string | null;
  userId: string | null;
}

async function fetchTraeUserInfo(accessToken: string): Promise<TraeUserInfo> {
  for (const origin of traeApiOrigins()) {
    const url: string = `${origin.replace(/\/$/, "")}${(TRAE_CONFIG as Record<string, string>).getUserInfoPath}`;
    try {
      const res: Response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": (TRAE_CONFIG as Record<string, string>).userAgent,
          "x-cloudide-token": accessToken,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) continue;
      const data: Record<string, unknown> = await res.json();
      return {
        email: extractJsonPath(data, [
          ["Result", "NonPlainTextEmail"], ["Result", "Email"], ["Result", "email"],
          ["email"], ["data", "email"],
        ]),
        name: extractJsonPath(data, [
          ["Result", "ScreenName"], ["Result", "Nickname"], ["Result", "Name"],
          ["result", "nickname"], ["nickname"], ["name"],
        ]),
        aiRegion: extractJsonPath(data, [["Result", "AIRegion"], ["Result", "aiRegion"], ["aiRegion"]]),
        region: extractJsonPath(data, [["Result", "Region"], ["Result", "region"], ["region"]]),
        tenant: extractJsonPath(data, [["Result", "TenantID"], ["Result", "tenantId"], ["tenantId"]]),
        userId: extractJsonPath(data, [["Result", "UserID"], ["Result", "userId"], ["userId"]]),
      };
    } catch { /* try next origin */ }
  }
  return { email: null, name: null, aiRegion: null, region: null, tenant: null, userId: null };
}

function traeScopeForRegion(aiRegion: string | null): string {
  const r: string = (aiRegion || "").toLowerCase();
  if (r === "sg" || r.includes("singapore")) return "marscode-sg";
  if (r === "cn" || r.includes("cn") || r.includes("china")) return "marscode-cn";
  return "marscode-us";
}

const trae = {
  config: TRAE_CONFIG,
  flowType: "authorization_code",
  callbackPath: (TRAE_CONFIG as Record<string, string>).callbackPath,
  prepareConfig: async (config: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const loginTraceID: string = crypto.randomUUID();
    const loginHost: string = await fetchTraeLoginGuidance(loginTraceID);
    return { ...config, loginTraceID, loginHost };
  },
  buildAuthUrl: (config: Record<string, unknown>, redirectUri: string, state: string): string => {
    const ctx: TraeDeviceContext = buildTraeDeviceContext();
    const traceId: string = (config.loginTraceID as string) || state;
    return buildTraeVerificationUrl(config.loginHost as string, traceId, redirectUri, ctx);
  },
  exchangeToken: async (config: Record<string, unknown>, code: string): Promise<Record<string, unknown>> => {
    const trimmed: string = String(code || "").trim();
    const looksCallback: boolean = /[?=&]/.test(trimmed) && (trimmed.includes("refreshToken") || trimmed.includes("refresh_token"));
    if (!looksCallback) {
      const clean: string = trimmed.replace(/^(Cloud-IDE-JWT|Bearer)\s+/i, "");
      return { accessToken: clean, refreshToken: null, expiresIn: (TRAE_CONFIG as Record<string, number>).tokenLifetimeDays * 24 * 60 * 60, _authMethod: "imported" };
    }
    const { refreshToken, cloudideToken } = parseTraeCallback(trimmed);
    return { ...(await fetchTraeExchangeToken(refreshToken, cloudideToken)), _authMethod: "oauth" };
  },
  postExchange: async (tokens: Record<string, unknown>): Promise<{ userInfo: TraeUserInfo }> => {
    const userInfo: TraeUserInfo = await fetchTraeUserInfo(tokens.accessToken as string);
    return { userInfo };
  },
  mapTokens: (tokens: Record<string, unknown>, extra: { userInfo: TraeUserInfo }): Record<string, unknown> => {
    const expiresIn: number = (tokens.expiresIn as number)
      || (tokens.expiresAt ? Math.max(60, Number(tokens.expiresAt) - Math.floor(Date.now() / 1000)) : (TRAE_CONFIG as Record<string, number>).tokenLifetimeDays * 24 * 60 * 60);
    const ui: TraeUserInfo = extra?.userInfo || { email: null, name: null, aiRegion: null, region: null, tenant: null, userId: null };
    const aiRegion: string = ui.aiRegion || "US-East";
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn,
      email: ui.email || undefined,
      displayName: ui.name || undefined,
      providerSpecificData: {
        authMethod: tokens._authMethod || "oauth",
        aiRegion,
        region: ui.region || aiRegion,
        tenant: ui.tenant || "marscode",
        userId: ui.userId || "",
        scope: traeScopeForRegion(aiRegion),
        webId: "",
        bizUserId: "",
        userUniqueId: "",
        appLanguage: "en",
        appVersion: (TRAE_CONFIG as Record<string, string>).defaultAppVersion,
        userRegion: aiRegion === "SG" ? "SG" : "US",
        userIdentity: "Free",
      },
    };
  },
};

export default trae;
