import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  applyPluginToggle,
  proposeHarnessCapability,
} from "@/server/harness/governance/applyPluginWrite";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";
import { sessionHasPlugin } from "@/server/harness/tools/sessionCapability";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Same reason as the memory endpoint: the Governance plugin being on was a
  // rendering decision in the browser and a check nowhere on this side.
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) return badRequest("sessionId is required");
  if (!(await sessionHasPlugin(sessionId, "tool-harness-governance"))) {
    return badRequest("The Governance plugin (tool-harness-governance) is not enabled for this conversation");
  }
  const action = body.action;
  if (action === "toggle") {
    const pluginId = typeof body.plugin_id === "string" ? body.plugin_id : "";
    if (!pluginId) return badRequest("plugin_id is required");
    const enabled = body.enabled !== false;
    const result = await applyPluginToggle({
      pluginId,
      enabled,
      // Hardcoded: this endpoint is only reached by the agent's tool executor,
      // and reading the origin from the body let a write declare itself an
      // operator action and skip the approval queue.
      source: "agent",
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
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ...result, ok: true });
  }
  return badRequest("action must be toggle or propose");
}
