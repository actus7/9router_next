import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  conversation: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => state.settings) }));
vi.mock("@/lib/db/repos/harnessConversationsRepo", () => ({
  getHarnessConversation: vi.fn(async () => state.conversation),
}));

import { sessionGatewayProfile } from "@/server/harness/tools/sessionGatewayProfile";
import {
  currentGatewayProfile,
  withGatewayProfile,
  withStoredKeyProfile,
} from "@/server/llm-gateway/application/gatewayProfile";

beforeEach(() => {
  state.settings = {};
  state.conversation = undefined;
});

describe("chat turn gateway profile", () => {
  it("reads the conversation's own abilities over the account default", async () => {
    state.settings = { cavemanEnabled: true, ponytailEnabled: true };
    state.conversation = { id: "s1", pluginSettings: { abilities: { caveman: { enabled: false } } } };
    const profile = await sessionGatewayProfile("s1");
    expect(profile.abilities.caveman.enabled).toBe(false);
    expect(profile.abilities.ponytail.enabled).toBe(true);
    expect(profile.skillIds).toEqual([]);
  });

  it("a conversation not yet synced gets the account default", async () => {
    state.settings = { synapseEnabled: true };
    expect((await sessionGatewayProfile("unknown")).abilities.synapse.enabled).toBe(true);
  });

  it("never carries API skills, even if the conversation data names some", async () => {
    state.conversation = { id: "s1", pluginSettings: { abilities: {} }, skillIds: ["tdd"] };
    expect((await sessionGatewayProfile("s1")).skillIds).toEqual([]);
  });

  it("regression: an API key's profile never reaches a chat turn", async () => {
    // The worker may forward one of the account's keys; the key had Caveman on.
    const keyProfile = JSON.stringify({ abilities: { caveman: { enabled: true } }, skillIds: ["pdf"] });
    state.conversation = { id: "s1", pluginSettings: { abilities: { caveman: { enabled: false } } } };
    const chat = await sessionGatewayProfile("s1");
    const seen = await withStoredKeyProfile(keyProfile, () => withGatewayProfile(chat, () => currentGatewayProfile()));
    expect(seen.abilities.caveman.enabled).toBe(false);
    expect(seen.skillIds).toEqual([]);
  });
});
