import "server-only";

import { resolveSessionPluginsFrom } from "@/shared/harness/agentPlugins";
import { getPluginTreeState } from "@/server/plugin-core/context";
import { catalogFromRows } from "@/server/plugin-core/bundleRows";
import { isAllowedByAccess } from "@/server/llm-gateway/application/accessScope";

/**
 * Whether a conversation has a harness plugin enabled.
 *
 * The browser decides which tools to offer a model, and the worker was taking
 * that list as the answer — so "memory only works with the Memory plugin on"
 * was a rendering decision, enforced nowhere. Anything that could post a run
 * body could write to the account's memory with the plugin off.
 *
 * Resolved the same way as the MCP target: from this account's own persisted
 * session record and its own plugin composition, never from the caller. Both
 * layers matter — the preset and toggles are per account, the overrides are
 * per conversation — so this reads them together rather than either alone.
 */
export async function sessionHasPlugin(sessionId: string, pluginId: string): Promise<boolean> {
  // The member's access policy is a ceiling over the conversation's toggles:
  // a plugin the organization did not grant this member stays off whatever the
  // conversation says.
  if (!isAllowedByAccess("plugins", pluginId)) return false;
  const { getHarnessConversation } = await import("@/lib/db/repos/harnessConversationsRepo");
  // By id, not by scanning the account: every conversation's `data` column
  // carries its whole message history, and this runs on every governed tool
  // call.
  const conversation = await getHarnessConversation(sessionId);
  // A run can name a conversation that was never synced — the client owns that
  // table and syncs on a debounce. Refusing then would break a first message,
  // so an unknown conversation gets the account's defaults, which is what it
  // would have been created with.
  const overrides = (conversation?.pluginOverrides ?? undefined) as
    | Record<string, boolean>
    | undefined;
  const catalog = catalogFromRows(getPluginTreeState().rows);
  return resolveSessionPluginsFrom(
    catalog,
    typeof conversation?.agentPresetId === "string" ? conversation.agentPresetId : undefined,
    overrides,
  ).some((plugin) => plugin.id === pluginId);
}

/**
 * The run body without the tools of plugins the current access scope forbids.
 *
 * The browser builds `tools` from the conversation's plugins, and the worker
 * runs whatever is listed — so a member's plugin policy has to be applied to
 * the body itself, before the model ever sees the tool. Context and mode
 * plugins only add prompt text and carry no capability; the chat screen hides
 * them, and nothing here needs to.
 */
export function withoutForbiddenPluginTools(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return body;
  const catalog = catalogFromRows(getPluginTreeState().rows);
  const forbidden = new Set(
    catalog.plugins
      .filter((plugin) => plugin.tool && !isAllowedByAccess("plugins", plugin.id))
      .map((plugin) => plugin.tool!.function.name),
  );
  if (forbidden.size === 0) return body;
  const tools = (body.tools as unknown[]).filter(
    (tool) => !forbidden.has(String((tool as { function?: { name?: unknown } })?.function?.name ?? "")),
  );
  if (tools.length === body.tools.length) return body;
  if (tools.length > 0) return { ...body, tools };
  // No tool left: a tool_choice naming one would be rejected upstream.
  const { tools: _tools, tool_choice: _toolChoice, ...rest } = body;
  return rest;
}
