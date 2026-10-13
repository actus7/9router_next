import { NextRequest, NextResponse } from "next/server";

import { currentTenantContext } from "@/lib/db/tenant";
import { resolveCurrentUser } from "@/server/application/http/tenantRoute";
import { memberRole } from "@/lib/auth/organizations";
import { listAccessPolicies, setAccessPolicy } from "@/lib/db/repos/accessPoliciesRepo";
import { getApiKeyById, getApiKeys } from "@/lib/db/repos/apiKeysRepo";
import { listAgentSkillRows } from "@/lib/db/repos/agentSkillsRepo";
import { BUNDLE_SKILLS } from "@/shared/harness/bundleSkills";
import { composeSkills } from "@/shared/harness/agentSkills";
import { catalogFromRows } from "@/server/plugin-core/bundleRows";
import { bootstrap, reloadPluginTree } from "@/server/plugin-core/context";
import { normalizeAccessPolicy, type AccessSubject } from "@/shared/access/accessPolicy";

/**
 * GET /api/access — who the caller is in this tenant, the policies they may
 * see, and the plugins and skills a policy can name.
 *
 * Owners and admins get every policy row; a member gets only the rows that
 * restrict them (their own and their keys'), so the dashboard can tell them
 * what they can use without showing them anyone else's limits.
 */
export async function GET() {
  const context = currentTenantContext();
  const [policies, catalog, user] = await Promise.all([listAccessPolicies(), accessCatalog(), resolveCurrentUser()]);
  // `getApiKeys` is already scoped to the keys a member created.
  const ownKeys = context.role === "member" ? new Set((await getApiKeys()).map((key) => key.id)) : null;
  const visible = ownKeys
    ? policies.filter((row) =>
        row.type === "org"
        || (row.type === "member" && row.subjectId === context.actorUserId)
        || (row.type === "key" && ownKeys.has(row.subjectId)))
    : policies;
  return NextResponse.json({
    me: {
      tenantId: context.tenantId,
      userId: context.actorUserId,
      role: context.role,
      personal: context.tenantId === context.actorUserId,
      email: user.email ?? null,
      emailVerified: user.emailVerified === true,
    },
    policies: visible,
    catalog,
  });
}

async function accessCatalog() {
  const ctx = await bootstrap();
  const tree = await reloadPluginTree(ctx);
  const plugins = catalogFromRows(tree.rows).plugins.map((plugin) => ({
    id: plugin.id,
    title: plugin.title,
    description: plugin.description,
    kind: plugin.kind,
  }));
  const rows = await listAgentSkillRows();
  const { skills } = composeSkills(
    BUNDLE_SKILLS,
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      body: row.body,
      enabled: row.enabled,
      source: row.source,
      origin: row.origin,
    })),
  );
  return {
    plugins,
    skills: skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
  };
}

const SUBJECTS: ReadonlySet<AccessSubject> = new Set(["org", "member", "key"]);

/**
 * PUT /api/access — replaces one subject's policy. `{ type, subjectId, policy }`;
 * an unrestricted policy (`{}`) removes the row. Admin-only, by `tenantRoute`'s
 * default for writes.
 *
 * The subject is checked against this tenant before anything is stored: a
 * policy row naming a key or a member from elsewhere would be dead weight at
 * best, and a way to probe ids at worst.
 */
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const type = body?.type as AccessSubject;
  if (!body || !SUBJECTS.has(type)) {
    return NextResponse.json({ error: "type must be org, member or key" }, { status: 400 });
  }
  const context = currentTenantContext();
  const subjectId = type === "org" ? context.tenantId : String(body.subjectId ?? "");
  if (!subjectId) return NextResponse.json({ error: "subjectId is required" }, { status: 400 });

  if (type === "key" && !(await getApiKeyById(subjectId))) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }
  if (type === "member") {
    const role = subjectId === context.tenantId ? "owner" : await memberRole(context.tenantId, subjectId);
    if (!role) return NextResponse.json({ error: "Not a member of this organization" }, { status: 404 });
    if (role !== "member") {
      // Owners and admins are not bound by a member policy (accessLayersFor);
      // storing one would show a limit that does nothing.
      return NextResponse.json({ error: "Owners and admins are not restricted by a member policy" }, { status: 400 });
    }
  }

  const policy = await setAccessPolicy(type, subjectId, normalizeAccessPolicy(body.policy));
  return NextResponse.json({ type, subjectId, policy });
}
