import { beforeEach } from "vitest";

import { __setTenantForTesting } from "@/lib/db/tenant";

/**
 * Every test runs as one fixed account.
 *
 * `currentTenantId()` throws with no context, which is what stops a repo
 * reaching tenant data outside a request — but it would also make every
 * repo test fail on setup instead of on the thing it asserts. Establishing a
 * tenant here keeps the tests about behaviour; the property that repos
 * actually filter is asserted directly by tests/unit/tenantIsolation.test.ts.
 */
export const TEST_TENANT_ID = "test-user";

beforeEach(() => {
  __setTenantForTesting(TEST_TENANT_ID);
});
