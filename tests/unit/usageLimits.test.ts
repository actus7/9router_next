import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Usage limits count against the subject that set them: the organization's
 * cap against everyone's spend, a member's against what that member spent, a
 * key's against that key. Over budget is refused before any provider is
 * called; over the per-minute rate is refused until the window turns.
 */

const limited = vi.hoisted(() => ({ value: [] as Array<{ type: string; id: string; limits: Record<string, number> }> }));
const spend = vi.hoisted(() => ({ value: {} as Record<string, number>, calls: 0 }));

vi.mock("@/lib/db/repos/accessPoliciesRepo", () => ({
  usageLimitsFor: async () => limited.value,
}));
vi.mock("@/lib/db/repos/usageSpendRepo", () => ({
  currentMonthStart: () => "2026-10-01T00:00:00.000Z",
  monthSpendUsd: async (scope: { type: string; id: string }) => {
    spend.calls++;
    return spend.value[`${scope.type}:${scope.id}`] ?? 0;
  },
}));

import { withTenant } from "@/lib/db/tenant";
import { __resetRateLimits } from "@/server/application/http/rateLimit";
import { __resetUsageLimits, checkUsageLimits } from "@/server/application/http/usageLimits";

const check = () =>
  withTenant({ tenantId: "org-1", actorUserId: "m-1", role: "member" }, () =>
    checkUsageLimits({ memberUserId: "m-1", memberRole: "member", apiKeyId: "k-1" }));

beforeEach(() => {
  limited.value = [];
  spend.value = {};
  spend.calls = 0;
  __resetRateLimits();
  __resetUsageLimits();
});

describe("checkUsageLimits", () => {
  it("lets a request through when nothing is limited, without reading spend", async () => {
    expect(await check()).toBeNull();
    expect(spend.calls).toBe(0);
  });

  it("refuses a member over their monthly budget, naming the subject", async () => {
    limited.value = [{ type: "member", id: "m-1", limits: { monthlyBudgetUsd: 10 } }];
    spend.value = { "member:m-1": 10.01 };
    const breach = await check();
    expect(breach).toMatchObject({ kind: "budget", subject: "member" });
    expect(breach!.retryAfter).toBeGreaterThan(0);
  });

  it("lets a member under budget through", async () => {
    limited.value = [{ type: "key", id: "k-1", limits: { monthlyBudgetUsd: 10 } }];
    spend.value = { "key:k-1": 9.99 };
    expect(await check()).toBeNull();
  });

  it("refuses the request past the per-minute rate, and only that one", async () => {
    limited.value = [{ type: "key", id: "k-1", limits: { rpm: 2 } }];
    expect(await check()).toBeNull();
    expect(await check()).toBeNull();
    expect(await check()).toMatchObject({ kind: "rpm", subject: "key" });
  });

  it("does not spend a rate slot on a request refused for budget", async () => {
    limited.value = [
      { type: "org", id: "org-1", limits: { monthlyBudgetUsd: 1 } },
      { type: "key", id: "k-1", limits: { rpm: 1 } },
    ];
    spend.value = { "org:org-1": 5 };
    expect(await check()).toMatchObject({ kind: "budget", subject: "org" });
    spend.value = {};
    __resetUsageLimits();
    expect(await check()).toBeNull();
  });

  it("does not spend an outer layer's slot on a request an inner layer refuses", async () => {
    limited.value = [
      { type: "org", id: "org-1", limits: { rpm: 2 } },
      { type: "key", id: "k-1", limits: { rpm: 1 } },
    ];
    expect(await check()).toBeNull();
    expect(await check()).toMatchObject({ kind: "rpm", subject: "key" });
    // The key's refusal did not take the org's second slot: another key of the
    // organization still gets it.
    limited.value = [{ type: "org", id: "org-1", limits: { rpm: 2 } }];
    expect(await check()).toBeNull();
  });
});

