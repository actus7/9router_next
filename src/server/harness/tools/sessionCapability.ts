import "server-only";

import { resolveSessionPluginsFrom } from "@/shared/harness/agentPlugins";
import { getPluginTreeState } from "@/server/plugin-core/context";
import { catalogFromRows } from "@/server/plugin-core/bundleRows";

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
  const { listHarnessConversations } = await import("@/lib/db/repos/harnessConversationsRepo");
  const conversations = await listHarnessConversations();
  const conversation = conversations.find((item) => item.id === sessionId);
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
