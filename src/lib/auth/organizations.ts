import "server-only";

import { getAdapter } from "@/lib/db/driver";
import type { TenantContext, TenantRole } from "@/lib/db/tenant";
import { TtlMemo } from "@/lib/ttlMemo";

/**
 * Organizations are Neon Auth's (Better Auth's organization plugin): it owns
 * `neon_auth.organization`, `member` and `invitation`, and the dashboard
 * manages them through its client API. This module is the one place the app
 * *reads* them — to decide which tenant a request runs as.
 *
 * A personal workspace is an organization whose id is the user's own id. It
 * exists implicitly (a user with no active organization runs as their own id,
 * which is what every row written before teams already says), and becomes a
 * real organization row only when its owner turns it into a team — so the data
 * they already have comes along with no migration.
 */

/**
 * How long a membership answer is trusted. A removed member keeps acting for
 * up to this long on an instance that cached them — the same window as an
 * API key revocation (`KEY_OWNER_TTL_MS`).
 */
const MEMBERSHIP_TTL_MS = 10_000;
const membershipMemo = new TtlMemo<TenantRole | "none">(MEMBERSHIP_TTL_MS);

/** Better Auth stores the role as text; several roles come comma-separated. */
export function normalizeRole(raw: unknown): TenantRole {
  const roles = String(raw ?? "").split(",").map((role) => role.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

/** The user's role in the organization, or null when they are not a member. */
export async function memberRole(organizationId: string, userId: string): Promise<TenantRole | null> {
  const key = `${organizationId}:${userId}`;
  const cached = membershipMemo.get(key);
  if (cached) return cached === "none" ? null : cached;
  const generation = membershipMemo.generation;
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT role FROM neon_auth.member WHERE "organizationId" = ? AND "userId" = ?`,
    [organizationId, userId],
  )) as { role?: unknown } | undefined;
  const role = row ? normalizeRole(row.role) : null;
  membershipMemo.set(key, role ?? "none", generation);
  return role;
}

export function invalidateMembership(): void {
  membershipMemo.clear();
}

/**
 * The tenant a signed-in user acts in.
 *
 * The session's active organization when they are still a member of it; their
 * personal workspace otherwise — including when they were removed from the
 * organization the session still points at, which must not keep them in.
 */
export async function resolveTenantContext(userId: string, activeOrganizationId: string | null | undefined): Promise<TenantContext> {
  const personal: TenantContext = { tenantId: userId, actorUserId: userId, role: "owner" };
  if (!activeOrganizationId || activeOrganizationId === userId) return personal;
  const role = await memberRole(activeOrganizationId, userId);
  return role ? { tenantId: activeOrganizationId, actorUserId: userId, role } : personal;
}

/**
 * The context an API key's requests run in: its organization, acting as the
 * member who created it. A key from before keys had an owner — or one whose
 * owner is the tenant itself — acts as the tenant's owner. A key whose owner
 * has left the organization stops working: null.
 */
export async function resolveKeyContext(tenantId: string, ownerUserId: string | null): Promise<TenantContext | null> {
  if (!ownerUserId || ownerUserId === tenantId) return { tenantId, actorUserId: tenantId, role: "owner" };
  const role = await memberRole(tenantId, ownerUserId);
  return role ? { tenantId, actorUserId: ownerUserId, role } : null;
}

/**
 * Turns the user's personal workspace into an organization others can join.
 *
 * Written directly rather than through Better Auth's `organization/create`,
 * because that would mint a new random id — an empty tenant — while the point
 * is to keep the providers, combos and history the user already has. Idempotent.
 */
export async function createTeamFromPersonalWorkspace(userId: string, name: string, slug: string): Promise<void> {
  const db = await getAdapter();
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO neon_auth.organization (id, name, slug, "createdAt")
       VALUES (?, ?, ?, now())
       ON CONFLICT (id) DO NOTHING`,
      [userId, name, slug],
    );
    const existing = await db.get(
      `SELECT 1 AS present FROM neon_auth.member WHERE "organizationId" = ? AND "userId" = ?`,
      [userId, userId],
    );
    if (!existing) {
      await db.run(
        `INSERT INTO neon_auth.member ("organizationId", "userId", role, "createdAt") VALUES (?, ?, 'owner', now())`,
        [userId, userId],
      );
    }
  });
  invalidateMembership();
}
