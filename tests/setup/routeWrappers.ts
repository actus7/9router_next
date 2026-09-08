import { vi } from "vitest";

import { TEST_TENANT_ID } from "./tenant";

/**
 * Passthrough stand-ins for `tenantRoute` and `gatewayRoute`.
 *
 * Route tests exercise what a handler does, not how it got its tenant. The
 * real wrappers pull in `@neondatabase/auth`, which reaches for `next/headers`
 * and cannot resolve outside a Next runtime — and even where it can, it would
 * answer 401 for a test with no session and no cookie jar.
 *
 * The tenant these handlers run under still comes from `tests/setup/tenant.ts`,
 * which every test gets. What the wrappers themselves guarantee is covered by
 * `tests/unit/tenantRouteCoverage.test.ts`, which reads the source rather than
 * importing it.
 */
export const routeWrapperMocks = {
  tenantRoute: <T>(handler: T): T => handler,
  gatewayRoute: <T>(handler: T): T => handler,
  currentUserId: vi.fn(async () => TEST_TENANT_ID),
  extractApiKey: vi.fn(() => "test-key"),
};
