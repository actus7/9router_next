import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  applyMemoryWrite,
  buildMemorySnapshot,
  type MemoryApplyAction,
} from "@/server/harness/memory/applyMemoryWrite";
import {
  getHarnessLearningConfig,
  updateHarnessLearningConfig,
} from "@/lib/db/repos/harnessLearningConfigRepo";
import type { MemoryScope } from "@/shared/harness/agentMemory";
import { sessionHasPlugin } from "@/server/harness/tools/sessionCapability";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const [snapshot, config] = await Promise.all([
    buildMemorySnapshot(),
    getHarnessLearningConfig(),
  ]);
  return NextResponse.json({ ok: true, ...snapshot, config });
}

export async function PUT(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.config && typeof body.config === "object") {
    const config = await updateHarnessLearningConfig(
      body.config as Parameters<typeof updateHarnessLearningConfig>[0],
    );
    return NextResponse.json({
      ok: true,
      config,
      ...(await buildMemorySnapshot()),
    });
  }

  const action = body.action;
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest("id is required");
    const result = await applyMemoryWrite({ action: "remove", id, source: "ui" });
    if (!result.ok) return badRequest(result.error ?? "Failed to delete");
    return NextResponse.json({ ok: true, ...(await buildMemorySnapshot()) });
  }

  if (action === "create") {
    const scope: MemoryScope = body.scope === "user" ? "user" : "agent";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const result = await applyMemoryWrite({
      action: "add",
      scope,
      content,
      source: "ui",
    });
    if (!result.ok) return badRequest(result.error ?? "Failed to create");
    return NextResponse.json({ ok: true, ...(await buildMemorySnapshot()) });
  }

  if (action === "update") {
    const id = typeof body.id === "string" ? body.id : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!id || !content) return badRequest("id and content are required");
    const result = await applyMemoryWrite({
      action: "replace",
      id,
      content,
      source: "ui",
    });
    if (!result.ok) return badRequest(result.error ?? "Failed to update");
    return NextResponse.json({ ok: true, ...(await buildMemorySnapshot()) });
  }

  return badRequest("Unknown action");
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as MemoryApplyAction | undefined;
  if (!action || !["add", "replace", "remove"].includes(action)) {
    return badRequest("action must be add, replace, or remove");
  }
  // Whether this conversation may touch the account's shared memory is the
  // server's call. It used to be nobody's: the browser decided by not offering
  // the tool, and this endpoint asked no one.
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) return badRequest("sessionId is required");
  if (!(await sessionHasPlugin(sessionId, "tool-memory"))) {
    return badRequest("The Memory plugin (tool-memory) is not enabled for this conversation");
  }
  // POST is the agent's path; the operator's edits arrive on PUT, which sets
  // its own origin server-side. This used to read `body.source`, so a write
  // could declare itself an operator action and skip the approval queue — the
  // gate was chosen by the caller.
  const source = "agent";
  const result = await applyMemoryWrite({
    action,
    scope: body.scope === "user" ? "user" : body.scope === "agent" ? "agent" : undefined,
    id: typeof body.id === "string" ? body.id : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    source,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, issues: result.issues },
      { status: 400 },
    );
  }
  const snapshot = await buildMemorySnapshot();
  return NextResponse.json({ ...snapshot, ...result, ok: true });
}
