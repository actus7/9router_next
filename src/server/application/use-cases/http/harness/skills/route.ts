import { NextRequest, NextResponse } from "next/server";
import {
  deleteAgentSkillRow,
  upsertAgentSkillRow,
} from "@/lib/db/repos/agentSkillsRepo";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  invalidateSkillTreeCache,
  isBundledSkillId,
  reloadSkillTree,
} from "@/server/harness/skills/context";
import {
  normalizeSkillId,
  validateSkillFields,
} from "@/server/harness/skills/parseSkillMarkdown";
import { BUNDLE_SKILLS, BUNDLE_SKILL_IDS } from "@/shared/harness/bundleSkills";
import type { AgentSkillRow } from "@/lib/db/repos/agentSkillsRepo";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function readPutBody(body: Record<string, unknown>): AgentSkillRow | string {
  const id = typeof body.id === "string" ? normalizeSkillId(body.id) : "";
  const name =
    typeof body.name === "string" ? normalizeSkillId(body.name) : id;
  const description =
    typeof body.description === "string" ? body.description : "";
  const skillBody = typeof body.body === "string" ? body.body : "";
  const enabled = body.enabled !== false;
  const sourceRaw = body.source;
  const origin = typeof body.origin === "string" ? body.origin : undefined;

  const errors = validateSkillFields({
    id,
    name,
    description,
    body: skillBody,
  });
  if (errors.length) return errors.map((e) => e.message).join("; ");

  const targetsBundle = BUNDLE_SKILL_IDS.has(id);
  let source: AgentSkillRow["source"];
  if (sourceRaw === "imported") source = "imported";
  else if (targetsBundle) source = "override";
  else source = "user";

  if (targetsBundle && source !== "override") {
    return "bundled skills can only be toggled via override";
  }

  if (targetsBundle) {
    const bundled = BUNDLE_SKILLS.find((skill) => skill.id === id)!;
    return {
      id,
      name: bundled.name,
      description: bundled.description,
      body: bundled.body,
      enabled,
      source: "override",
    };
  }

  return {
    id,
    name,
    description: description || name,
    body: skillBody || " ",
    enabled,
    source,
    origin,
  };
}

function serialize(state: Awaited<ReturnType<typeof reloadSkillTree>>) {
  return {
    revision: state.revision,
    skills: state.skills,
    diagnostics: state.diagnostics,
    bundleSkillIds: [...BUNDLE_SKILL_IDS],
  };
}

export async function GET(request: NextRequest) {
  await assertRequestRuntime();
  const state = await reloadSkillTree();
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const skill = state.skills.find((item) => item.id === normalizeSkillId(id));
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, skill });
  }
  return NextResponse.json(serialize(state));
}

export async function PUT(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const row = readPutBody(body);
  if (typeof row === "string") return badRequest(row);

  if (isBundledSkillId(row.id) && row.source === "override") {
    await upsertAgentSkillRow(row);
  } else {
    await upsertAgentSkillRow(row);
  }

  return NextResponse.json(serialize(await invalidateSkillTreeCache()));
}

export async function DELETE(request: NextRequest) {
  await assertRequestRuntime();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return badRequest("id is required");
  const normalized = normalizeSkillId(id);
  await deleteAgentSkillRow(normalized);
  return NextResponse.json(serialize(await invalidateSkillTreeCache()));
}
