// Public server API of the LLM gateway â€” auth, account selection and token lifecycle.
import "server-only";

// API-key validation + account selection/fallback
export {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "./auth/accountSelection";

// Token refresh + credential persistence
export {
  refreshGoogleToken,
  refreshCodexToken,
  updateProviderCredentials,
  checkAndRefreshToken,
} from "./auth/tokenRefresh";

// Proactive background refresh scheduler
export {
  BACKGROUND_REFRESH_LEAD_MS,
  selectConnectionsNeedingRefresh,
  runBackgroundTokenRefreshTick,
  startBackgroundTokenRefresh,
  stopBackgroundTokenRefresh,
} from "./auth/backgroundTokenRefresh";

// Credential manager internals used by provider testing utilities
export {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "@/lib/open-sse/services/oauthCredentialManager";
export { buildClineHeaders } from "@/lib/open-sse/shared/clineAuth";
