import { NextRequest, NextResponse } from "next/server";
import {
  deleteAgentSkillRow,
  upsertAgentSkillRow,
} from "@/lib/db/repos/agentSkillsRepo";
import {
  deleteAgentSkillFilesForSkill,
  isValidSkillFilePath,
  listAgentSkillFiles,
  replaceAgentSkillFiles,
} from "@/lib/db/repos/agentSkillFilesRepo";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  invalidateSkillTreeCache,
  reloadSkillTree,
} from "@/server/harness/skills/context";
import {
  normalizeSkillId,
  validateSkillFields,
} from "@/server/harness/skills/parseSkillMarkdown";
import { BUNDLE_SKILLS, BUNDLE_SKILL_IDS } from "@/shared/harness/bundleSkills";
import type { AgentSkillRow } from "@/lib/db/repos/agentSkillsRepo";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

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

function readSkillFiles(body: Record<string, unknown>): Array<{ filePath: string; content: string }> | string {
  if (!Array.isArray(body.files)) return [];
  const files: Array<{ filePath: string; content: string }> = [];
  for (const entry of body.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return "files must be an array of { path, content } objects";
    }
    const record = entry as Record<string, unknown>;
    const filePath =
      typeof record.path === "string"
        ? record.path.trim().toLowerCase()
        : typeof record.filePath === "string"
          ? record.filePath.trim().toLowerCase()
          : "";
    const content = typeof record.content === "string" ? record.content : "";
    if (!filePath || !content.trim()) return "each file needs path and content";
    if (!isValidSkillFilePath(filePath)) return `invalid skill file path: ${filePath}`;
    if (content.length > 32_768) return `file too large: ${filePath}`;
    files.push({ filePath, content: content.trim() });
  }
  return files;
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
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const state = await reloadSkillTree();
  const id = new URL(request.url).searchParams.get("id");
  const filePath = new URL(request.url).searchParams.get("file");
  if (id) {
    const normalized = normalizeSkillId(id);
    const skill = state.skills.find((item) => item.id === normalized);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const files = await listAgentSkillFiles(normalized);
    if (filePath) {
      const normalizedPath = filePath.trim().toLowerCase();
      const match = files.find((file) => file.filePath === normalizedPath);
      if (!match) {
        return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, file: match });
    }
    return NextResponse.json({
      ok: true,
      skill: {
        ...skill,
        files: files.map((file) => ({
          path: file.filePath,
          size: file.content.length,
        })),
      },
    });
  }
  return NextResponse.json(serialize(state));
}

export async function PUT(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const row = readPutBody(body);
  if (typeof row === "string") return badRequest(row);
  const files = readSkillFiles(body);
  if (typeof files === "string") return badRequest(files);

  await upsertAgentSkillRow(row);
  if (files.length > 0 && row.source !== "override") {
    await replaceAgentSkillFiles(row.id, files.map((file) => ({
      filePath: file.filePath,
      content: file.content,
    })));
  }

  return NextResponse.json(serialize(await invalidateSkillTreeCache()));
}

export async function DELETE(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return badRequest("id is required");
  const normalized = normalizeSkillId(id);
  await deleteAgentSkillFilesForSkill(normalized);
  await deleteAgentSkillRow(normalized);
  return NextResponse.json(serialize(await invalidateSkillTreeCache()));
}
