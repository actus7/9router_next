import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  applyMemoryWrite,
  buildMemorySnapshot,
  type MemoryApplyAction,
} from "@/server/harness/memory/applyMemoryWrite";
import { invalidateMemoryCache } from "@/server/harness/memory/context";
import {
  getHarnessLearningConfig,
  updateHarnessLearningConfig,
} from "@/lib/db/repos/harnessLearningConfigRepo";
import type { MemoryScope } from "@/shared/harness/agentMemory";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  await assertRequestRuntime();
  const [snapshot, config] = await Promise.all([
    buildMemorySnapshot(),
    getHarnessLearningConfig(),
  ]);
  return NextResponse.json({ ok: true, ...snapshot, config });
}

export async function PUT(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.config && typeof body.config === "object") {
    const config = await updateHarnessLearningConfig(
      body.config as Parameters<typeof updateHarnessLearningConfig>[0],
    );
    return NextResponse.json({
      ok: true,
      config,
      ...(await invalidateMemoryCache()),
    });
  }

  const action = body.action;
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest("id is required");
    const result = await applyMemoryWrite({ action: "remove", id, source: "ui" });
    if (!result.ok) return badRequest(result.error ?? "Failed to delete");
    return NextResponse.json({ ok: true, ...(await invalidateMemoryCache()) });
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
    return NextResponse.json({ ok: true, ...(await invalidateMemoryCache()) });
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
    return NextResponse.json({ ok: true, ...(await invalidateMemoryCache()) });
  }

  return badRequest("Unknown action");
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as MemoryApplyAction | undefined;
  if (!action || !["add", "replace", "remove"].includes(action)) {
    return badRequest("action must be add, replace, or remove");
  }
  const source =
    body.source === "review" ? "review" : body.source === "ui" ? "ui" : "agent";
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
  const snapshot = result.pending ? await buildMemorySnapshot() : await invalidateMemoryCache();
  return NextResponse.json({ ...snapshot, ...result, ok: true });
}
