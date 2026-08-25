import { WINDSURF_CONFIG } from "../constants/oauth";
import { extractJsonPath } from "./_shared";

interface ProviderConfig {
  clientId: string;
  authBaseUrl: string;
  signInPath: string;
  registerApiBaseUrl: string;
  registerPath: string;
  oneTimeAuthPath: string;
  currentUserPath: string;
  defaultApiServerUrl: string;
  callbackPath: string;
  userAgent: string;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: null;
  expiresIn: null;
  email?: string;
  displayName?: string;
  providerSpecificData: {
    authMethod: string;
    apiServerUrl: string;
    firebaseIdToken: string | null;
  };
}

async function windsurfSeatRequest(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url: string = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res: Response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": (WINDSURF_CONFIG as ProviderConfig).userAgent,
    },
    body: JSON.stringify(body),
  });
  const text: string = await res.text();
  if (!res.ok) throw new Error(`Windsurf ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Windsurf ${path} invalid JSON`); }
}

interface WindsurfCallbackResult {
  firebaseIdToken: string;
}

function parseWindsurfCallback(raw: string, expectedState?: string): WindsurfCallbackResult {
  const text: string = String(raw || "").trim();
  let queryStr: string = text;
  if (text.includes("?")) queryStr = text.slice(text.indexOf("?") + 1);
  if (text.startsWith("#")) queryStr = text.slice(1);
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(queryStr));
  const pick = (keys: string[]): string | null => {
    for (const k of keys) { const v: string = params[k]; if (v && String(v).trim()) return String(v).trim(); }
    return null;
  };
  const err: string | null = pick(["error"]);
  if (err) {
    const desc: string | null = pick(["error_description"]);
    throw new Error(desc ? `Windsurf auth failed: ${err} (${desc})` : `Windsurf auth failed: ${err}`);
  }
  const accessToken: string | null = pick(["access_token", "token"]);
  if (!accessToken) throw new Error("Windsurf callback missing access_token");
  const state: string | null = pick(["state"]);
  if (expectedState && state && state !== expectedState) {
    throw new Error("Windsurf callback state mismatch");
  }
  return { firebaseIdToken: accessToken };
}

interface WindsurfRegisterResult {
  apiKey: string;
  apiServerUrl: string;
  name: string | null;
}

async function fetchWindsurfRegisterUser(firebaseIdToken: string): Promise<WindsurfRegisterResult> {
  const data: Record<string, unknown> = await windsurfSeatRequest((WINDSURF_CONFIG as ProviderConfig).registerApiBaseUrl, (WINDSURF_CONFIG as ProviderConfig).registerPath, {
    firebase_id_token: firebaseIdToken,
  });
  const apiKey: string | null = extractJsonPath(data, [["apiKey"], ["api_key"]]);
  if (!apiKey) throw new Error("Windsurf RegisterUser missing apiKey");
  const apiServerUrl: string = extractJsonPath(data, [["apiServerUrl"], ["api_server_url"]]) || (WINDSURF_CONFIG as ProviderConfig).defaultApiServerUrl;
  const name: string | null = extractJsonPath(data, [["name"]]);
  return { apiKey, apiServerUrl, name };
}

interface WindsurfUserInfo {
  email: string | null;
  name: string | null;
}

async function fetchWindsurfUserInfo(apiServerUrl: string, firebaseIdToken: string): Promise<WindsurfUserInfo> {
  try {
    const authRes: Record<string, unknown> = await windsurfSeatRequest(apiServerUrl, (WINDSURF_CONFIG as ProviderConfig).oneTimeAuthPath, { firebaseIdToken });
    const authToken: string | null = extractJsonPath(authRes, [["authToken"], ["auth_token"]]);
    if (!authToken) return { email: null, name: null };
    const userRes: Record<string, unknown> = await windsurfSeatRequest(apiServerUrl, (WINDSURF_CONFIG as ProviderConfig).currentUserPath, {
      authToken,
      includeSubscription: true,
    });
    const user: Record<string, unknown> = (userRes.user as Record<string, unknown>) || userRes;
    return {
      email: extractJsonPath(user, [["email"]]),
      name: extractJsonPath(user, [["name"]]),
    };
  } catch { return { email: null, name: null }; }
}

const windsurf = {
  config: WINDSURF_CONFIG,
  flowType: "authorization_code",
  callbackPath: (WINDSURF_CONFIG as ProviderConfig).callbackPath,
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string): string => {
    const params: URLSearchParams = new URLSearchParams({
      response_type: "token",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state,
      prompt: "login",
      redirect_parameters_type: "query",
      workflow: "onboarding",
    });
    return `${config.authBaseUrl}${config.signInPath}?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string, codeVerifier: string, state: string): Promise<Record<string, unknown>> => {
    const trimmed: string = String(code || "").trim();
    const looksCallback: boolean = trimmed.includes("?") || trimmed.includes("access_token=");
    if (!looksCallback) {
      const clean: string = trimmed.replace(/^Bearer\s+/i, "");
      if (clean.startsWith("sk-ws-")) {
        return { accessToken: clean, refreshToken: null, expiresIn: null, apiServerUrl: config.defaultApiServerUrl, firebaseIdToken: null, _authMethod: "imported" };
      }
      const reg: WindsurfRegisterResult = await fetchWindsurfRegisterUser(clean);
      return { accessToken: reg.apiKey, refreshToken: null, expiresIn: null, apiServerUrl: reg.apiServerUrl, firebaseIdToken: clean, _authMethod: "imported" };
    }
    const { firebaseIdToken } = parseWindsurfCallback(trimmed, state);
    const reg: WindsurfRegisterResult = await fetchWindsurfRegisterUser(firebaseIdToken);
    return { accessToken: reg.apiKey, refreshToken: null, expiresIn: null, apiServerUrl: reg.apiServerUrl, firebaseIdToken, _authMethod: "oauth" };
  },
  postExchange: async (tokens: Record<string, unknown>): Promise<{ userInfo: WindsurfUserInfo }> => {
    if (!tokens.firebaseIdToken) return { userInfo: { email: null, name: null } };
    const info: WindsurfUserInfo = await fetchWindsurfUserInfo(tokens.apiServerUrl as string, tokens.firebaseIdToken as string);
    return { userInfo: info };
  },
  mapTokens: (tokens: Record<string, unknown>, extra: { userInfo: WindsurfUserInfo }): MappedTokens => ({
    accessToken: tokens.accessToken as string,
    refreshToken: null,
    expiresIn: null,
    email: extra?.userInfo?.email || undefined,
    displayName: extra?.userInfo?.name || undefined,
    providerSpecificData: {
      authMethod: (tokens._authMethod as string) || "oauth",
      apiServerUrl: tokens.apiServerUrl as string,
      firebaseIdToken: (tokens.firebaseIdToken as string) || null,
    },
  }),
};

export default windsurf;
