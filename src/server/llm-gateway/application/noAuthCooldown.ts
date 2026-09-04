// Server-side cooldown for noAuth providers to prevent rapid-fire retries.
// Free providers answer 429/402 quickly and clients retry immediately, so the
// gateway remembers the penalty per provider instead of forwarding the storm.
//
// This used to be a process-local Map, which meant the gateway ran two
// unrelated cooldown mechanisms: `modelAvailability` for credentialed accounts
// (durable, per account+model, visible in the availability UI) and this one for
// noAuth providers (lost on every restart, invisible everywhere). The free
// default provider is a noAuth provider, so the last-resort routing path had
// the more fragile of the two — exactly where predictable behaviour matters
// most. It now writes to the same table under a synthetic connection id.

import {
  getActiveModelAvailability,
  setModelAvailability,
} from "@/lib/db/repos/modelAvailabilityRepo";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { FREE_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import * as log from "../utils/logger";

const RATE_LIMIT_COOLDOWN_MS = 15000;
const BILLING_COOLDOWN_MS = 30000;

/**
 * A noAuth provider has no connection row, so it borrows a namespaced id.
 *
 * Note this is deliberately NOT a real `providerConnections.id`, which is why
 * `modelAvailability.connectionId` must never gain a FOREIGN KEY — there is no
 * parent row for these. `deleteProviderConnection` clears its own children
 * explicitly instead; see the child-row delete policy test.
 */
function noAuthConnectionId(provider: string): string {
  return `noauth:${resolveProviderId(provider)}`;
}

/** The cooldown is provider-wide, matching what noAuth providers actually gate. */
const ALL_MODELS = "__all";

/**
 * The cooldown substitutes for account rotation, which noAuth providers do not
 * have. A credentialed provider must keep rotating instead: freezing it
 * process-wide would strand every other account behind one 429.
 */
function isNoAuthProvider(provider: string): boolean {
  return FREE_PROVIDERS[resolveProviderId(provider)]?.noAuth === true;
}

/** The part of a chat result that decides whether a cooldown starts. */
export interface CooldownTriggerResult {
  status?: number;
  error?: string;
}

/** Remaining cooldown in ms, or 0. Expired rows are swept by the periodic cleanup. */
export async function isNoAuthOnCooldown(provider: string): Promise<number> {
  const rows = await getActiveModelAvailability([noAuthConnectionId(provider)], ALL_MODELS);
  const until = rows[0]?.until;
  if (!until) return 0;
  return Math.max(0, Date.parse(until) - Date.now());
}

export async function setNoAuthCooldown(
  provider: string,
  ms: number,
  errorCode: number | null = null,
  lastError: string | null = null,
): Promise<void> {
  await setModelAvailability({
    connectionId: noAuthConnectionId(provider),
    modelId: ALL_MODELS,
    status: "cooldown",
    reason: errorCode === 402 ? "billing" : "rate_limit",
    errorCode,
    lastError,
    until: new Date(Date.now() + ms).toISOString(),
  });
}

function cooldownResponse(
  message: string,
  status: number,
  retryAfterSec: number,
  type: string,
  code: string,
): Response {
  return new Response(
    JSON.stringify({ error: { message, type, code } }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "Access-Control-Allow-Origin": "*",
      }
    }
  );
}

/** Check noAuth cooldown. Returns error Response or null. */
export async function checkNoAuthCooldownResponse(provider: string, model: string): Promise<Response | null> {
  if (!isNoAuthProvider(provider)) return null;
  const cooldownRemaining = await isNoAuthOnCooldown(provider);
  if (cooldownRemaining <= 0) return null;
  const retryAfterSec = Math.ceil(cooldownRemaining / 1000);
  log.warn("CHAT", `[${provider}/${model}] Server-side cooldown active (${retryAfterSec}s remaining)`);
  return cooldownResponse(
    `[${provider}/${model}] Rate limited. Retry after ${retryAfterSec}s`,
    HTTP_STATUS.RATE_LIMITED,
    retryAfterSec,
    "rate_limit_error",
    "rate_limit_exceeded",
  );
}

/** Handle noAuth cooldown on rate-limit/billing errors. Returns Response or null. */
export async function handleNoAuthCooldownResult(
  result: CooldownTriggerResult,
  provider: string,
  model: string,
): Promise<Response | null> {
  if (!isNoAuthProvider(provider)) return null;
  if (!("status" in result) || (result.status !== 429 && result.status !== 402)) return null;
  const cooldownMs = result.status === 429 ? RATE_LIMIT_COOLDOWN_MS : BILLING_COOLDOWN_MS;
  await setNoAuthCooldown(provider, cooldownMs, result.status, result.error ?? null);
  const retryAfterSec = Math.ceil(cooldownMs / 1000);
  log.warn("CHAT", `[${provider}/${model}] noAuth cooldown set (${retryAfterSec}s) after ${result.status}`);
  return cooldownResponse(
    `[${provider}/${model}] ${result.error}. Retry after ${retryAfterSec}s`,
    result.status,
    retryAfterSec,
    result.status === 429 ? "rate_limit_error" : "billing_error",
    result.status === 429 ? "rate_limit_exceeded" : "payment_required",
  );
}
