import pkg from "../../../package.json" with { type: "json" };

// App configuration
export const APP_CONFIG = {
  name: "ModelHub",
  description: "AI Infrastructure Management",
  version: pkg.version,
} as const;


// GitHub configuration
export const GITHUB_CONFIG = {
  changelogUrl: "/CHANGELOG.md",
} as const;


// Updater configuration
export const UPDATER_CONFIG = {
  npmPackageName: "modelhub",
  installCmd: "npm i -g modelhub",
  installCmdLatest: "npm i -g modelhub@latest --prefer-online",
  exitDelayMs: 500,
  statusPort: 20129,
  statusPollIntervalMs: 1000,
  statusLogTailLines: 8,
  installRetries: 3,
  installRetryDelayMs: 5000,
  lingerAfterDoneMs: 30000,
  waitForExitMinMs: 5000,
  waitForExitMaxMs: 20000,
  waitForExitCheckMs: 500,
  appPort: 20128,
} as const;


// Theme configuration
void ({
  storageKey: "theme",
  defaultTheme: "system", // "light" | "dark" | "system"
} as const);


// Subscription
void ({
  price: 1.0,
  currency: "USD",
  interval: "month",
  planName: "Pro Plan",
} as const);


// API endpoints
void ({
  users: "/api/users",
  providers: "/api/providers",
  payments: "/api/payments",
  auth: "/api/auth",
} as const);


export const CONSOLE_LOG_CONFIG = {
  maxLines: 200,
  pollIntervalMs: 1000,
} as const;


// Client-side store TTL: how long fetched data stays fresh before re-fetching
void (60000 as const);

// Quota auto-ping: keep 5h windows warm by sending a tiny request right after reset.
export const QUOTA_AUTOPING_CONFIG = {
  tickIntervalMs: 60000,                // scheduler tick
  pingLeadMs: 5000,                     // fire once reset passes (within tolerance)
  refreshAheadMs: 300000,               // refetch usage when within 5min of reset
  failureCooldownMs: 900000,            // avoid failed ping spam while upstream/auth is unhealthy
  providers: {
    claude: {
      settingsKey: "claudeAutoPing",    // preserve existing settings contract
      quotaKey: "session (5h)",         // quota key returned by usage handler
      pingModel: "claude-haiku-4-5-20251001",
      pingText: "hi",
      pingMaxTokens: 1,
    },
    codex: {
      settingsKey: "codexAutoPing",
      quotaKey: "session",
      pingWhenResetAtSlides: true,
      resetAtDriftMs: 30000,
      minPingIntervalMs: 600000,
      skipWhenBlockingQuotaExhausted: true,
      // Free and Plus Codex accounts both expose gpt-5.5; avoid fallback probes that waste requests.
      pingModel: "gpt-5.5",
      pingText: "hi",
      pingInstructions: "Reply with OK.",
      pingReasoningEffort: "none",
    },
  },
} as const;


// Re-export from providers.js for backward compatibility
export {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
} from "./providers";

// Re-export from models.js for backward compatibility
export {
  AI_MODELS,
} from "./models";
