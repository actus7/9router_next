// The one API-key gate for every public gateway endpoint. It used to be copied
// into each application handler, which is how the eight copies drifted in their
// logging. Behaviour is unchanged: 401 with the same messages as before.

import { AsyncLocalStorage } from "node:async_hooks";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { isValidApiKey } from "../auth/accountSelection";
import { errorResponse } from "@/server/llm-gateway/engine/utils/error";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import * as log from "../utils/logger";

// The key `gatewayRoute` already resolved to an owner for this request. Only a
// scope that route entered can hold one, so an in-process caller with no route
// around it — the durable-run worker — still gets the full lookup below.
const verifiedKeyStorage: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();

/** Runs `fn` with `apiKey` recorded as verified. Called by `gatewayRoute` only. */
export function withVerifiedGatewayKey<T>(apiKey: string, fn: () => T): T {
  return verifiedKeyStorage.run(apiKey, fn);
}

/**
 * Enforce `settings.requireApiKey` for a gateway request.
 * @param apiKey key already extracted from the request (see `extractApiKey`)
 * @returns an error Response to return immediately, or null when allowed
 */
export async function requireGatewayApiKey(apiKey: string | null): Promise<Response | null> {
  // Same key the route resolved moments ago: the answer is "allowed" whatever
  // `requireApiKey` says, so neither the settings nor the apiKeys read is needed.
  // Any other key (or none) falls through to the full check.
  if (apiKey && verifiedKeyStorage.getStore() === apiKey) return null;
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
