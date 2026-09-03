import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  applyPluginToggle,
  proposeHarnessCapability,
} from "@/server/harness/governance/applyPluginWrite";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  if (action === "toggle") {
    const pluginId = typeof body.plugin_id === "string" ? body.plugin_id : "";
    if (!pluginId) return badRequest("plugin_id is required");
    const enabled = body.enabled !== false;
    const result = await applyPluginToggle({
      pluginId,
      enabled,
      source: body.source === "ui" ? "ui" : "agent",
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ...result, ok: true });
  }
  if (action === "propose") {
    const result = await proposeHarnessCapability({
      title: typeof body.title === "string" ? body.title : "",
      description: typeof body.description === "string" ? body.description : "",
      toolName: typeof body.tool_name === "string" ? body.tool_name : "",
      source: body.source === "ui" ? "ui" : "agent",
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ...result, ok: true });
  }
  return badRequest("action must be toggle or propose");
}
