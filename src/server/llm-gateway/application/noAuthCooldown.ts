// Server-side cooldown for noAuth providers to prevent rapid-fire retries.
// Free providers answer 429/402 quickly and clients retry immediately, so the
// gateway remembers the penalty per provider instead of forwarding the storm.

import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { FREE_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import * as log from "../utils/logger";

const RATE_LIMIT_COOLDOWN_MS = 15000;
const BILLING_COOLDOWN_MS = 30000;

const noAuthCooldowns = new Map<string, number>();

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

export function isNoAuthOnCooldown(provider: string): number {
  const until = noAuthCooldowns.get(provider);
  if (!until) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    noAuthCooldowns.delete(provider);
    return 0;
  }
  return remaining;
}

export function setNoAuthCooldown(provider: string, ms: number): void {
  noAuthCooldowns.set(provider, Date.now() + ms);
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
export function checkNoAuthCooldownResponse(provider: string, model: string): Response | null {
  if (!isNoAuthProvider(provider)) return null;
  const cooldownRemaining = isNoAuthOnCooldown(provider);
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
export function handleNoAuthCooldownResult(
  result: CooldownTriggerResult,
  provider: string,
  model: string,
): Response | null {
  if (!isNoAuthProvider(provider)) return null;
  if (!("status" in result) || (result.status !== 429 && result.status !== 402)) return null;
  const cooldownMs = result.status === 429 ? RATE_LIMIT_COOLDOWN_MS : BILLING_COOLDOWN_MS;
  setNoAuthCooldown(provider, cooldownMs);
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
