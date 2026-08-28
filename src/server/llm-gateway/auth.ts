// Public server API of the LLM gateway — auth, account selection and token lifecycle.
import "server-only";

// API-key validation + account selection/fallback
export {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "@/sse/services/auth";

// Token refresh + credential persistence
export {
  refreshGoogleToken,
  refreshCodexToken,
  updateProviderCredentials,
  checkAndRefreshToken,
} from "@/sse/services/tokenRefresh";

// Proactive background refresh scheduler
export {
  BACKGROUND_REFRESH_LEAD_MS,
  selectConnectionsNeedingRefresh,
  runBackgroundTokenRefreshTick,
  startBackgroundTokenRefresh,
  stopBackgroundTokenRefresh,
} from "@/sse/services/backgroundTokenRefresh";

// Credential manager internals used by provider testing utilities
export {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "@/lib/open-sse/services/oauthCredentialManager";
export { buildClineHeaders } from "@/lib/open-sse/shared/clineAuth";
