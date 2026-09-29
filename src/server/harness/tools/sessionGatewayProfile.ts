import "server-only";

import { getSettings } from "@/lib/db/repos/settingsRepo";
import { normalizeGatewayProfile, profileFromSettings, type GatewayProfile } from "@/shared/gateway/gatewayProfile";

/**
 * The gateway profile a chat turn runs with, from the conversation itself.
 *
 * Same contract as `sessionHasPlugin`: read from this account's persisted
 * conversation, never from the run body. The abilities live in the
 * conversation's `pluginSettings.abilities` (edited in the chat's plugin
 * settings); anything the conversation never set — and a conversation not yet
 * synced — takes the account's `settings` flags, which is what every chat turn
 * used before abilities moved into the conversation.
 *
 * `skillIds` is always empty: the chat has its own skills (descriptions plus
 * `load_skill`), and the API's full-body injection would double them.
 */
export async function sessionGatewayProfile(sessionId: string): Promise<GatewayProfile> {
  const { getHarnessConversation } = await import("@/lib/db/repos/harnessConversationsRepo");
  const [conversation, settings] = await Promise.all([
    getHarnessConversation(sessionId).catch(() => undefined),
    getSettings(),
  ]);
  const accountDefault = profileFromSettings(settings);
  const pluginSettings = conversation?.pluginSettings as Record<string, unknown> | undefined;
  const profile = normalizeGatewayProfile({ abilities: pluginSettings?.abilities }, accountDefault);
  return { abilities: profile.abilities, skillIds: [] };
}
