import { Suspense, type ReactNode } from "react";

import { withTenantPage } from "@/server/application/http/withTenantPage";

async function AdminGate({ children }: { children: ReactNode }) {
  return withTenantPage(async () => children, { minRole: "admin" });
}

/**
 * Wraps a page whose content is for owners and admins — usage of everyone,
 * request logs, quotas, deployments. A member is redirected to the chat before
 * any of it renders, instead of landing on a screen whose every request
 * answers 403 (the API refuses them either way; this is the honest screen).
 *
 * The check awaits the session, so it sits under its own Suspense boundary and
 * the page itself stays synchronous (see docs/CONVENTIONS.md).
 */
export function AdminOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
