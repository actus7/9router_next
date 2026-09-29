import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { parseStoredProfile, profileFromSettings, type GatewayProfile } from "@/shared/gateway/gatewayProfile";

/**
 * The profile the current request runs with, set by whoever knows where the
 * request came from — never read from the request itself:
 * - `gatewayRoute` enters the key's stored profile for the public API;
 * - the chat worker enters the conversation's profile.
 *
 * The chat worker may forward one of the account's keys (`requireApiKey`), and
 * `handleChat` runs in-process without `gatewayRoute`, so the key never gets to
 * speak for a chat turn: the conversation's scope is the one in effect.
 *
 * A key's scope holds the raw column and resolves on first read: most gateway
 * routes (models, voices, embeddings) never ask, and should not pay a
 * `settings` read to build a profile nobody uses.
 */
type ProfileScope =
  | { kind: "resolved"; profile: GatewayProfile }
  | { kind: "stored"; stored: string | null };

const profileStorage: AsyncLocalStorage<ProfileScope> = new AsyncLocalStorage<ProfileScope>();

export function withGatewayProfile<T>(profile: GatewayProfile, fn: () => T): T {
  return profileStorage.run({ kind: "resolved", profile }, fn);
}

/** Scopes a request to an API key's `apiKeys.profile` column. Called by `gatewayRoute` only. */
export function withStoredKeyProfile<T>(stored: string | null, fn: () => T): T {
  return profileStorage.run({ kind: "stored", stored }, fn);
}

/**
 * The profile in effect. A key never edited (NULL column) and a request outside
 * any scope both answer with the account's `settings` flags — exactly what every
 * request read before profiles existed.
 */
export async function currentGatewayProfile(): Promise<GatewayProfile> {
  const scope = profileStorage.getStore();
  if (scope?.kind === "resolved") return scope.profile;
  const legacy = profileFromSettings(await getSettings());
  if (scope?.kind === "stored") return parseStoredProfile(scope.stored, legacy) ?? legacy;
  return legacy;
}
