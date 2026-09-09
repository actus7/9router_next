import { NextRequest, NextResponse } from "next/server";
import { serializeHttpError } from "@/server/application/http/httpError";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "@/server/llm-gateway/catalog";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { isCredentialEncryptionEnabled } from "@/lib/db/helpers/credentialCipher";
import { DATA_DIR_IS_EPHEMERAL } from "@/lib/dataDir";


const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password"];

export async function GET(): Promise<NextResponse> {
  await assertRequestRuntime();
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      // Derived, never stored: whether CREDENTIAL_KEY is configured. Surfaced so
      // "credentials are encrypted at rest" is a thing the operator can see
      // rather than assume — an install that never set the env runs in clear.
      credentialEncryptionEnabled: isCredentialEncryptionEnabled(),
      // Derived, never stored: whether the data directory survives a restart.
      // False on any host with a real disk; true when the app fell back to the
      // OS temp dir because the home directory was unwritable (Vercel and other
      // read-only serverless hosts). Since the Neon migration this says nothing
      // about the database or the stored credentials — those are in Postgres —
      // only about the host-local features that keep files on disk: the
      // tunnel, pxpipe and headroom.
      storageEphemeral: DATA_DIR_IS_EPHEMERAL
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error getting settings:", error);
    // Never the raw message: a Neon failure carries the query fragment and the
    // host, and TenantContextError carries internal wording.
    return serializeHttpError(error, "Failed to load settings");
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  await assertRequestRuntime();
  try {
    const body = await request.json();

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    // The password branch that used to live here hashed `newPassword` into
    // `settings.password` — a column nothing has authenticated against since
    // identity moved to Neon Auth. `SecurityCard` sends people to the provider
    // instead. Kept only as a note, because a write-only credential path reads
    // like a live one in every security review.

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings as Record<string, unknown>);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/server/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error updating settings:", error);
    return serializeHttpError(error, "Failed to update settings");
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
