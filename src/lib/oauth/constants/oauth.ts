/**
 * OAuth Configuration Constants — static data lives in registry, re-exported here for consumers.
 */
import { platform, arch } from "os";
import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "@/lib/open-sse/providers/shared";
import { PROVIDER_OAUTH, PROVIDERS as REGISTRY_PROVIDERS } from "@/lib/open-sse/providers/index";

/**
 * Get the platform enum value based on the current OS.
 * Matches Antigravity binary's ClientMetadata.Platform enum.
 */
function getOAuthPlatformEnum(): number {
  const os: string = platform();
  const architecture: string = arch();
  if (os === "darwin") return architecture === "arm64" ? 2 : 1;
  if (os === "linux") return architecture === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

// Claude OAuth Configuration (Authorization Code Flow with PKCE)
export const CLAUDE_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["claude"] };

// Codex (OpenAI) OAuth Configuration (Authorization Code Flow with PKCE)
export const CODEX_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["codex"] };

// Gemini (Google) OAuth Configuration (Standard OAuth2)
export const GEMINI_CONFIG: Record<string, unknown> = { ...(GOOGLE_OAUTH_CLIENT as Record<string, unknown>), ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["gemini-cli"] };

// Qoder OAuth Configuration (Device Token Flow with PKCE).
export const QODER_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["qoder"] };

// iFlow OAuth Configuration (Authorization Code)
export const IFLOW_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["iflow"] };

// Antigravity OAuth Configuration (Standard OAuth2 with Google)
export const ANTIGRAVITY_CONFIG: Record<string, unknown> = {
  ...(ANTIGRAVITY_OAUTH_CLIENT as Record<string, unknown>),
  ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["antigravity"],
  loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
};

/**
 * Get client metadata using numeric enum values for API calls.
 */
export function getOAuthClientMetadata(): { ideType: number; platform: number; pluginType: number } {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

// OpenAI OAuth Configuration (Authorization Code Flow with PKCE)
const OPENAI_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["openai"] };

// GitHub Copilot OAuth Configuration (Device Code Flow)
export const GITHUB_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["github"] };

// Kiro OAuth Configuration (multi-method: AWS Builder ID / IDC / Social / Import Token)
export const KIRO_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["kiro"] };

// AWS region allowlist pattern — prevents SSRF via region injection into upstream URLs
const AWS_REGION_PATTERN: RegExp = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

// Reject any region that is not a valid AWS region before interpolating it into a URL
export function assertValidAwsRegion(region: string): string {
  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}

// Cursor OAuth Configuration (Import Token from Cursor IDE)
export const CURSOR_CONFIG: Record<string, unknown> = {
  ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["cursor"],
  tokenStoragePaths: {
    linux: "~/.config/Cursor/User/globalStorage/state.vscdb",
    macos: "/Users/<user>/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    windows: "%APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb",
  },
};

// Kimi Code OAuth (Device Code Flow)
export const KIMI_CONFIG: Record<string, unknown> = {
  ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["kimi"],
  clientId:
    process.env.KIMI_CODING_OAUTH_CLIENT_ID ||
    process.env.KIMI_OAUTH_CLIENT_ID ||
    (REGISTRY_PROVIDERS as Record<string, { clientId?: string }>)["kimi"]?.clientId ||
    (PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["kimi"]?.clientId,
};

// KiloCode OAuth Configuration (Custom Device Auth Flow)
export const KILOCODE_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["kilocode"] };

// Cline OAuth Configuration (Local Callback Flow via app.cline.bot)
export const CLINE_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["cline"] };

// ClinePass OAuth Configuration (shares Cline's OAuth endpoints)
export const CLINEPASS_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["clinepass"] };

// GitLab Duo OAuth Configuration (Authorization Code Flow with PKCE)
export const GITLAB_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["gitlab"] };

// CodeBuddy (Tencent) OAuth Configuration (Browser OAuth Polling Flow)
export const CODEBUDDY_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["codebuddy-cn"] };

// CodeBuddy International
export const CODEBUDDY_INTL_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["codebuddy-intl"] };

// Kimchi OAuth Configuration (Browser token callback flow)
export const KIMCHI_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["kimchi"] };

// Grok CLI / Grok Build OAuth Configuration (Device Code Flow)
export const GROK_CLI_CONFIG: Record<string, unknown> = { ...(PROVIDER_OAUTH as Record<string, Record<string, unknown>>)["grok-cli"] };

// Trae (ByteDance marscode) OAuth
export const TRAE_CONFIG: Record<string, unknown> = {
  clientId: "ono9krqynydwx5",
  clientSecret: "-",
  loginGuidanceUrls: [
    "https://api.marscode.com/cloudide/api/v3/trae/GetLoginGuidance",
    "https://api.trae.ai/cloudide/api/v3/trae/GetLoginGuidance",
    "https://www.trae.ai/cloudide/api/v3/trae/GetLoginGuidance",
  ],
  apiOrigins: [
    "https://api.marscode.com",
    "https://api.trae.ai",
    "https://www.trae.ai",
    "https://www.marscode.com",
  ],
  exchangeTokenPath: "/cloudide/api/v3/trae/oauth/ExchangeToken",
  getUserInfoPath: "/cloudide/api/v3/trae/GetUserInfo",
  authorizationPath: "/authorization",
  callbackPath: "/callback",
  minAppVersion: "3.5.54",
  defaultAppVersion: "3.5.54",
  defaultAppType: "stable",
  defaultPluginVersion: "local",
  defaultDeviceId: "0",
  userAgent: "Trae/1.0.0 antigravity-cockpit-tools",
  webUrl: "https://www.trae.ai",
  authScheme: "Cloud-IDE-JWT",
  tokenLifetimeDays: 14,
  oauthTimeoutMs: 600_000,
};

// Windsurf / Devin CLI OAuth
export const WINDSURF_CONFIG: Record<string, unknown> = {
  clientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
  authBaseUrl: "https://www.windsurf.com",
  signInPath: "/windsurf/signin",
  registerApiBaseUrl: "https://register.windsurf.com",
  registerPath: "/exa.seat_management_pb.SeatManagementService/RegisterUser",
  oneTimeAuthPath: "/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken",
  currentUserPath: "/exa.seat_management_pb.SeatManagementService/GetCurrentUser",
  planStatusPath: "/exa.seat_management_pb.SeatManagementService/GetPlanStatus",
  userStatusPath: "/exa.seat_management_pb.SeatManagementService/GetUserStatus",
  defaultApiServerUrl: "https://server.codeium.com",
  firebaseApiKey: process.env.WINDSURF_FIREBASE_API_KEY || "",
  callbackPath: "/windsurf-auth-callback",
  userAgent: "antigravity-cockpit-tools",
  oauthTimeoutMs: 600_000,
};

// Zed hosted LLM aggregator — RSA keypair native-app auth (NOT OAuth).
export const ZED_HOSTED_CONFIG: Record<string, unknown> = {
  webBaseUrl: "https://zed.dev",
  cloudBaseUrl: "https://cloud.zed.dev",
  llmBaseUrl: "https://cloud.zed.dev",
  defaultNativeAppPort: 58443,
  oauthTimeoutMs: 600_000,
};

// OAuth timeout (5 minutes)
export const OAUTH_TIMEOUT: number = 300000;

// Provider list
const PROVIDERS: Record<string, string> = {
  CLAUDE: "claude",
  CODEX: "codex",
  GEMINI: "gemini-cli",
  QODER: "qoder",
  IFLOW: "iflow",
  ANTIGRAVITY: "antigravity",
  OPENAI: "openai",
  GITHUB: "github",
  KIRO: "kiro",
  CURSOR: "cursor",
  KIMI: "kimi",
  KIMI_CODING: "kimi",
  KILOCODE: "kilocode",
  CLINE: "cline",
  CLINEPASS: "clinepass",
  GITLAB: "gitlab",
  CODEBUDDY: "codebuddy-cn",
  CODEBUDDY_INTL: "codebuddy-intl",
  KIMCHI: "kimchi",
  GROK_CLI: "grok-cli",
  TRAE: "trae",
  WINDSURF: "windsurf",
  ZED: "zed",
};
