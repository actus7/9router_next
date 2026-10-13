// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { hydrateFromStorage, persistToStorage } from "@/app/(dashboard)/dashboard/basic-chat/hooks/chatSessionStorage";

/**
 * The chat keeps a local copy of the conversations in this browser. It was one
 * global key, so whoever signed in next on the same browser — another person,
 * or the same person in another team — was shown the previous account's
 * conversations, and the sync would then upload them as theirs.
 */

const session = (id: string, title: string) => ({ id, title, messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });

function persist(scope: string, sessions: ReturnType<typeof session>[]) {
  persistToStorage(
    {
      sessions: sessions as never,
      activeSessionId: sessions[0]?.id ?? "",
      activeProviderId: "",
      activeModelId: "",
      drafts: {},
      projects: [],
      activeProjectId: "",
      sidebarOpen: true,
      conversationDisplay: "compact",
      enterBehavior: "queue",
    },
    scope,
  );
}

beforeEach(() => localStorage.clear());

describe("chat local storage scope", () => {
  it("never shows one account's conversations to another", () => {
    persist("team-1:alice", [session("a1", "Alice's chat")]);
    expect(hydrateFromStorage("team-1:bob").sessions).toEqual([]);
    expect(hydrateFromStorage("team-1:alice").sessions.map((s) => s.id)).toEqual(["a1"]);
  });

  it("keeps the same person's copies apart per workspace", () => {
    persist("team-1:alice", [session("a1", "Team chat")]);
    expect(hydrateFromStorage("alice:alice").sessions).toEqual([]);
  });

  it("does not import the old global copy into whoever signs in next, and drops it", () => {
    localStorage.setItem("basic-chat.sessions", JSON.stringify([session("old", "Someone's old chat")]));
    localStorage.setItem("basic-chat.drafts", JSON.stringify({ old: { text: "secret", attachments: [] } }));

    const hydrated = hydrateFromStorage("team-1:bob");

    expect(hydrated.sessions).toEqual([]);
    expect(hydrated.drafts).toEqual({});
    expect(localStorage.getItem("basic-chat.sessions")).toBeNull();
    expect(localStorage.getItem("basic-chat.drafts")).toBeNull();
  });

  it("keeps browser-wide preferences shared", () => {
    persist("team-1:alice", []);
    localStorage.setItem("basic-chat.sidebarOpen", "false");
    expect(hydrateFromStorage("team-1:bob").sidebarOpen).toBe(false);
  });
});
