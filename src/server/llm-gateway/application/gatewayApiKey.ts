// The one API-key gate for every public gateway endpoint. It used to be copied
// into each application handler, which is how the eight copies drifted in their
// logging. Behaviour is unchanged: 401 with the same messages as before.

import { getSettings } from "@/lib/db/repos/settingsRepo";
import { isValidApiKey } from "../auth/accountSelection";
import { errorResponse } from "@/server/llm-gateway/engine/utils/error";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import * as log from "../utils/logger";

/**
 * Enforce `settings.requireApiKey` for a gateway request.
 * @param apiKey key already extracted from the request (see `extractApiKey`)
 * @returns an error Response to return immediately, or null when allowed
 */
export async function requireGatewayApiKey(apiKey: string | null): Promise<Response | null> {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;
  if (!apiKey) {
    log.warn("AUTH", "Missing API key (requireApiKey=true)");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
  }
  if (!(await isValidApiKey(apiKey))) {
    log.warn("AUTH", "Invalid API key (requireApiKey=true)");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}
