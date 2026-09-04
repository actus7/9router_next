import { NextRequest, NextResponse } from "next/server";
import { deletePluginRow, upsertPluginRow } from "@/lib/db/repos/pluginRowsRepo";
import { getActiveHarnessCatalog } from "@/shared/harness/agentPlugins";
import { BUNDLE_ROWS } from "@/server/plugin-core/bundleRows";
import type { PatchRow } from "@/server/plugin-core/composition";
import { factoryRegistry } from "@/server/plugin-core/factories";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  bootstrap,
  getPluginTreeState,
  reloadPluginTree,
  type PluginTreeState,
} from "@/server/plugin-core/context";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

// Reads and edits the plugin patch layer. Every write recomposes the tree in
// this process so the response already reflects what the chat will resolve
// against, rather than leaving the caller to guess.

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Rejects a row before it is stored, with the same rules composition applies. */
function readPatchRow(body: Record<string, unknown>): PatchRow | string {
  const { id, plugin, config, position, enabled, source } = body;
  if (typeof id !== "string" || !id) return "id is required";
  if (typeof plugin !== "string" || !plugin) return "plugin is required";
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "config must be an object";
  }
  if (!factoryRegistry.has(plugin)) return `unknown plugin factory: ${plugin}`;

  const invalid = factoryRegistry.validate(plugin, config as Record<string, unknown>);
  if (invalid) return invalid;

  const targetsBundleRow = BUNDLE_ROWS.some((row) => row.id === id);
  const resolvedSource = source === "user" || source === "override" ? source : undefined;
  if (resolvedSource === "override" && !targetsBundleRow) {
    return "override targets no bundle row";
  }

  return {
    id,
    plugin,
    config: config as Record<string, unknown>,
    position: Number.isFinite(position) ? Number(position) : 0,
    enabled: enabled !== false,
    source: resolvedSource ?? (targetsBundleRow ? "override" : "user"),
  };
}

function serialize(state: PluginTreeState) {
  return {
    revision: state.revision,
    rows: state.rows,
    diagnostics: state.diagnostics,
    bundleRowIds: BUNDLE_ROWS.map((row) => row.id),
    catalog: getActiveHarnessCatalog(),
  };
}

export async function GET() {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  await bootstrap();
  return NextResponse.json(serialize(getPluginTreeState()));
}

export async function PUT(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const row = readPatchRow(body);
  if (typeof row === "string") return badRequest(row);

  await upsertPluginRow(row);
  const ctx = await bootstrap();
  return NextResponse.json(serialize(await reloadPluginTree(ctx)));
}

export async function DELETE(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return badRequest("id is required");

  await deletePluginRow(id);
  const ctx = await bootstrap();
  return NextResponse.json(serialize(await reloadPluginTree(ctx)));
}
// Application HTTP use case extracted from the Next.js route adapter.
