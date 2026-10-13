import "server-only";

import { NextResponse } from "next/server";

import { usageLimitsFor, type AccessLayerSubjects } from "@/lib/db/repos/accessPoliciesRepo";
import { currentMonthStart, monthSpendUsd } from "@/lib/db/repos/usageSpendRepo";
import { currentTenantId } from "@/lib/db/tenant";
import { TtlMemo } from "@/lib/ttlMemo";
import type { AccessSubject } from "@/shared/access/accessPolicy";
import { consumeRateLimit, peekRateLimit } from "./rateLimit";

/**
 * Spend is summed from usageHistory, so it is cached: a budget may overshoot
 * by what one minute of traffic costs.
 * ponytail: per-process memo; a shared counter if overshoot ever matters.
 */
const SPEND_TTL_MS = 60_000;
const spendMemo = new TtlMemo<number>(SPEND_TTL_MS);

/**
 * Counted per process, like the account-wide limiter beside it (rateLimit.ts):
 * on several instances the effective rate is `rpm × instances`.
 * ponytail: per-process window; a shared counter when per-plan quotas need exactness.
 */
const RPM_WINDOW_MS = 60_000;

export interface LimitBreach {
  kind: "rpm" | "budget";
  subject: AccessSubject;
  /** Seconds until the limit lifts: the next minute, or the next month. */
  retryAfter: number;
  message: string;
}

const SUBJECT_NAME: Record<AccessSubject, string> = {
  org: "this organization",
  member: "this member",
  key: "this API key",
};

function secondsToNextMonth(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

async function spentThisMonth(type: AccessSubject, id: string): Promise<number> {
  const cacheKey = `${currentTenantId()}:${type}:${id}:${currentMonthStart()}`;
  const cached = spendMemo.get(cacheKey);
  if (cached !== undefined) return cached;
  const generation = spendMemo.generation;
  const spent = await monthSpendUsd({ type, id });
  spendMemo.set(cacheKey, spent, generation);
  return spent;
}

/**
 * Whether a request may run under the usage limits of the subjects it counts
 * against, or which limit it broke. Budgets are checked first so a refused
 * request never takes a per-minute slot.
 */
export async function checkUsageLimits(subjects: AccessLayerSubjects): Promise<LimitBreach | null> {
  const limited = await usageLimitsFor(subjects);
  for (const { type, id, limits } of limited) {
    if (limits.monthlyBudgetUsd === undefined) continue;
    if ((await spentThisMonth(type, id)) >= limits.monthlyBudgetUsd) {
      return {
        kind: "budget",
        subject: type,
        retryAfter: secondsToNextMonth(),
        message: `Monthly budget of US$ ${limits.monthlyBudgetUsd.toFixed(2)} reached for ${SUBJECT_NAME[type]}. Ask an owner or admin to raise it.`,
      };
    }
  }
  // Every layer is asked before any takes a slot: a request the key refuses
  // must not use up the organization's minute for its other keys.
  const rated = limited.filter((subject) => subject.limits.rpm !== undefined);
  const bucket = (type: AccessSubject, id: string) => `limit:${currentTenantId()}:${type}:${id}`;
  for (const { type, id, limits } of rated) {
    const slot = peekRateLimit(bucket(type, id), limits.rpm!);
    if (!slot.allowed) {
      return {
        kind: "rpm",
        subject: type,
        retryAfter: slot.retryAfter,
        message: `Rate limit of ${limits.rpm} request${limits.rpm === 1 ? "" : "s"} per minute reached for ${SUBJECT_NAME[type]}.`,
      };
    }
  }
  for (const { type, id, limits } of rated) consumeRateLimit(bucket(type, id), limits.rpm!, RPM_WINDOW_MS);
  return null;
}

/** The OpenAI-shaped 429 a client already knows how to back off from. */
export function limitBreachResponse(breach: LimitBreach): NextResponse {
  return NextResponse.json(
    {
      error: {
        message: breach.message,
        type: breach.kind === "rpm" ? "rate_limit_error" : "insufficient_quota",
        code: breach.kind === "rpm" ? "rate_limit_exceeded" : "budget_exceeded",
      },
    },
    { status: 429, headers: { "Retry-After": String(breach.retryAfter) } },
  );
}

export function __resetUsageLimits(): void {
  spendMemo.clear();
}
