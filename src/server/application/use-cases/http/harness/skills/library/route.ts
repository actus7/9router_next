import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { installSkillFromLibrary } from "@/server/harness/skills/installSkillFromLibrary";
import { reloadSkillTree } from "@/server/harness/skills/context";
import { searchSkillLibrary } from "@/server/harness/skills/skillLibrarySearch";
import { BUNDLE_SKILL_IDS } from "@/shared/harness/bundleSkills";
import { SKILL_LIBRARIES } from "@/shared/harness/skillLibraries";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  await assertRequestRuntime();
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const libraryId = params.get("library") ?? "all";
  const limit = Number(params.get("limit") ?? "20");

  const result = await searchSkillLibrary({
    query,
    libraryId,
    limit: Number.isFinite(limit) ? limit : 20,
  });

  return NextResponse.json({
    ok: true,
    libraries: SKILL_LIBRARIES,
    query: result.query,
    libraryId: result.libraryId,
    skills: result.skills,
  });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = typeof body.source === "string" ? body.source.trim() : "";
  const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
  const enabled = body.enabled === true;

  if (!source || !skillId) return badRequest("source and skillId are required");

  const outcome = await installSkillFromLibrary({ source, skillId, enabled });
  if (!outcome.ok) return badRequest(outcome.error);

  const state = await reloadSkillTree();
  return NextResponse.json({
    ok: true,
    installedId: outcome.skillId,
    sourceUrl: outcome.url,
    revision: state.revision,
    skills: state.skills,
    bundleSkillIds: [...BUNDLE_SKILL_IDS],
  });
}
