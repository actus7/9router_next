import { NextRequest, NextResponse } from "next/server";

import { currentTenantContext } from "@/lib/db/tenant";
import { createTeamFromPersonalWorkspace } from "@/lib/auth/organizations";

const MAX_NAME = 80;

function slugFor(name: string, userId: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  // Slugs are unique across Neon Auth; a fragment of the id keeps two teams
  // called "Acme" from colliding without asking the user to pick again.
  return `${base || "team"}-${userId.replace(/-/g, "").slice(0, 6)}`;
}

/**
 * POST /api/team/convert — turns the caller's personal workspace into a team
 * others can be invited to, keeping every provider, combo and conversation it
 * already has (the organization takes the user's own id; see
 * `createTeamFromPersonalWorkspace`). The client then switches the session to
 * it with `organization.setActive`.
 *
 * Only from the personal workspace, by its owner: converting someone else's
 * organization is not a thing.
 */
export async function POST(request: NextRequest) {
  const context = currentTenantContext();
  if (context.tenantId !== context.actorUserId) {
    return NextResponse.json({ error: "Switch to your personal workspace to turn it into a team" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return NextResponse.json({ error: "Team name is required" }, { status: 400 });

  await createTeamFromPersonalWorkspace(context.actorUserId, name, slugFor(name, context.actorUserId));
  return NextResponse.json({ organizationId: context.actorUserId, name });
}
