import { getAdapter } from "../driver";
import { currentActorUserId, currentTenantId, tryCurrentTenantContext, type TenantRole } from "../tenant";
import { TtlMemo } from "@/lib/ttlMemo";
import {
  isUnrestricted,
  normalizeAccessPolicy,
  parseStoredAccessPolicy,
  type AccessPolicy,
  type AccessSubject,
  type UsageLimits,
} from "@/shared/access/accessPolicy";

/**
 * One row per restricted subject. A subject with no row is unrestricted, so a
 * tenant that never touched policies pays one cached empty read and nothing
 * else.
 *
 * The whole tenant is read at once and cached: there are a handful of rows per
 * organization (one per restricted member or key), and the gateway asks on
 * every request. Writes here drop the cache; another instance's write is seen
 * within the TTL — so tightening a key's policy takes up to that long to reach
 * every instance, the same window as a key revocation.
 */
const POLICIES_TTL_MS = 15_000;
const policiesMemo = new TtlMemo<Map<string, AccessPolicy>>(POLICIES_TTL_MS);

const keyOf = (type: AccessSubject, subjectId: string): string => `${type}:${subjectId}`;

interface PolicyRow {
  subjectType: string;
  subjectId: string;
  policy: string;
}

async function tenantPolicies(): Promise<Map<string, AccessPolicy>> {
  const tenantId = currentTenantId();
  const cached = policiesMemo.get(tenantId);
  if (cached) return cached;
  const generation = policiesMemo.generation;
  const db = await getAdapter();
  const rows = (await db.all(`SELECT subjectType, subjectId, policy FROM accessPolicies WHERE userId = ?`, [
    tenantId,
  ])) as unknown as PolicyRow[];
  const map = new Map<string, AccessPolicy>();
  for (const row of rows) {
    map.set(keyOf(row.subjectType as AccessSubject, row.subjectId), parseStoredAccessPolicy(row.policy));
  }
  policiesMemo.set(tenantId, map, generation);
  return map;
}

/** The subject's own policy; `{}` (unrestricted) when it has none. */
export async function getAccessPolicy(type: AccessSubject, subjectId: string): Promise<AccessPolicy> {
  return (await tenantPolicies()).get(keyOf(type, subjectId)) ?? {};
}

/** Every policy row of the tenant, for listings. */
export async function listAccessPolicies(): Promise<Array<{ type: AccessSubject; subjectId: string; policy: AccessPolicy }>> {
  const map = await tenantPolicies();
  return [...map.entries()].map(([key, policy]) => {
    const separator = key.indexOf(":");
    return { type: key.slice(0, separator) as AccessSubject, subjectId: key.slice(separator + 1), policy };
  });
}

/**
 * Replaces the subject's policy. An unrestricted policy deletes the row
 * instead of storing `{}` — "no row" is the one way to say "no restriction".
 */
export async function setAccessPolicy(type: AccessSubject, subjectId: string, raw: unknown): Promise<AccessPolicy> {
  const policy = normalizeAccessPolicy(raw);
  const tenantId = currentTenantId();
  const db = await getAdapter();
  if (isUnrestricted(policy)) {
    await db.run(`DELETE FROM accessPolicies WHERE userId = ? AND subjectType = ? AND subjectId = ?`, [
      tenantId,
      type,
      subjectId,
    ]);
  } else {
    await db.run(
      `INSERT INTO accessPolicies (userId, subjectType, subjectId, policy, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (userId, subjectType, subjectId)
       DO UPDATE SET policy = excluded.policy, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`,
      [tenantId, type, subjectId, JSON.stringify(policy), new Date().toISOString(), currentActorUserId()],
    );
  }
  policiesMemo.delete(tenantId);
  return policy;
}

/** Drops a subject's row — for a deleted key or a removed member. */
export async function deleteAccessPolicy(type: AccessSubject, subjectId: string): Promise<void> {
  await setAccessPolicy(type, subjectId, {});
}

export interface AccessLayerSubjects {
  /** The member the request acts as. */
  memberUserId?: string | null;
  memberRole?: TenantRole | null;
  /** The API key the request authenticated with. */
  apiKeyId?: string | null;
}

/**
 * The layers a request runs under, outermost first: the organization's policy,
 * then the member's, then the key's.
 *
 * A member's own layer applies to the `member` role only. Owners and admins
 * edit policies; restricting them by a row they can rewrite would be a lock
 * whose key hangs next to it.
 */
export async function accessLayersFor(subjects: AccessLayerSubjects): Promise<AccessPolicy[]> {
  const map = await tenantPolicies();
  const tenantId = currentTenantId();
  const layers: AccessPolicy[] = [];
  const org = map.get(keyOf("org", tenantId));
  if (org) layers.push(org);
  if (subjects.memberUserId && subjects.memberRole === "member") {
    const member = map.get(keyOf("member", subjects.memberUserId));
    if (member) layers.push(member);
  }
  if (subjects.apiKeyId) {
    const key = map.get(keyOf("key", subjects.apiKeyId));
    if (key) layers.push(key);
  }
  return layers;
}

/** The layers for whoever the current tenant context says is acting (dashboard and chat). */
export async function accessLayersForActor(): Promise<AccessPolicy[]> {
  const context = tryCurrentTenantContext();
  if (!context) return [];
  return accessLayersFor({ memberUserId: context.actorUserId, memberRole: context.role });
}

export interface LimitedSubject {
  type: AccessSubject;
  id: string;
  limits: UsageLimits;
}

/**
 * The subjects whose usage limits a request counts against, outermost first —
 * the same subjects and the same member rule as `accessLayersFor`.
 */
export async function usageLimitsFor(subjects: AccessLayerSubjects): Promise<LimitedSubject[]> {
  const map = await tenantPolicies();
  const wanted: Array<[AccessSubject, string | null | undefined]> = [
    ["org", currentTenantId()],
    ["member", subjects.memberRole === "member" ? subjects.memberUserId : null],
    ["key", subjects.apiKeyId],
  ];
  const limited: LimitedSubject[] = [];
  for (const [type, id] of wanted) {
    const limits = id ? map.get(keyOf(type, id))?.limits : undefined;
    if (id && limits) limited.push({ type, id, limits });
  }
  return limited;
}

export function invalidateAccessPolicies(): void {
  policiesMemo.clear();
}
