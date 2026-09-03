// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { finalizeStreamError } from "@/app/(dashboard)/dashboard/basic-chat/hooks/finalizeStreamResult";
import { useSessionHandlers } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSessionHandlers";
import type { ChatSession } from "@/app/(dashboard)/dashboard/basic-chat/types";

function makeSession(messages: ChatSession["messages"]): ChatSession {
  return { id: "s1", messages } as unknown as ChatSession;
}

describe("finalizeStreamError on a user-initiated stop", () => {
  it("settles every still-streaming message instead of leaving it mid-stream", () => {
    let session = makeSession([
      { id: "a1", role: "assistant", content: "partial", status: "streaming" },
      { id: "a2", role: "assistant", content: "continuation", status: "streaming" },
      { id: "u1", role: "user", content: "hi", status: "done" },
    ] as unknown as ChatSession["messages"]);
    const updateSession = (_id: string, updater: (s: ChatSession) => ChatSession) => {
      session = updater(session);
    };
    const setChatError = vi.fn();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });

    finalizeStreamError("s1", "a1", abort, updateSession, () => {}, setChatError);

    expect(session.messages.map((m) => m.status)).toEqual(["done", "done", "done"]);
    expect(session.messages[0]!.content).toBe("partial");
    // A stop is not a failure, so no error banner is raised.
    expect(setChatError).not.toHaveBeenCalled();
  });

  it("still reports a genuine failure", () => {
    let session = makeSession([
      { id: "a1", role: "assistant", content: "", status: "streaming" },
    ] as unknown as ChatSession["messages"]);
    const updateSession = (_id: string, updater: (s: ChatSession) => ChatSession) => {
      session = updater(session);
    };
    const setChatError = vi.fn();

    finalizeStreamError("s1", "a1", new Error("upstream 500"), updateSession, () => {}, setChatError);

    expect(session.messages[0]!.status).toBe("error");
    expect(setChatError).toHaveBeenCalledWith("upstream 500");
  });
});

type HandlerArgs = Parameters<typeof useSessionHandlers>[0];

function callHandlers(overrides: Partial<HandlerArgs>) {
  const noop = () => {};
  const base = {
    providerGroups: [],
    modelIndex: new Map(),
    sessions: [],
    setSessions: noop,
    projects: [],
    setProjects: noop,
    activeSessionId: "",
    setActiveSessionId: noop,
    activeProviderId: "",
    setActiveProviderId: noop,
    activeModelId: "",
    setActiveModelId: noop,
    activeProjectId: "",
    setActiveProjectId: noop,
    setDraft: noop,
    setAttachments: noop,
    setAttachmentNotice: noop,
    setHistoryOpen: noop,
    newProjectName: "",
    setNewProjectName: noop,
    setIsCreatingProject: noop,
    renamingSessionId: "",
    setRenamingSessionId: noop,
    setRenameValue: noop,
    renameValue: "",
    selectedSessionIds: new Set<string>(),
    setSelectedSessionIds: noop,
    filteredSessionItems: [],
    allVisibleSessionsSelected: false,
    fileInputRef: { current: null },
  } as unknown as HandlerArgs;
  return renderHook(() => useSessionHandlers({ ...base, ...overrides })).result.current;
}

describe("commitRenameSession", () => {
  it("ignores the blur that follows an escape-cancelled rename", () => {
    const setSessions = vi.fn();
    // Escape clears the renaming id first; the blur then arrives for a row
    // that is no longer being renamed and must not write the discarded value.
    const handlers = callHandlers({
      renamingSessionId: "",
      renameValue: "discarded draft",
      setSessions,
    });

    handlers.commitRenameSession("s1");

    expect(setSessions).not.toHaveBeenCalled();
  });

  it("commits while the row is still the one being renamed", () => {
    const setSessions = vi.fn();
    const handlers = callHandlers({
      renamingSessionId: "s1",
      renameValue: "New title",
      setSessions,
    });

    handlers.commitRenameSession("s1");

    expect(setSessions).toHaveBeenCalledTimes(1);
  });
});

describe("handleNewChat", () => {
  it("does not stack another empty conversation on top of an empty one", () => {
    const setSessions = vi.fn();
    const current = { id: "s1", messages: [], isArchived: false } as unknown as ChatSession;
    const handlers = callHandlers({
      sessions: [current],
      activeSessionId: "s1",
      setSessions,
      modelIndex: new Map([["m1", { id: "m1", providerId: "p1" }]]) as HandlerArgs["modelIndex"],
    });

    handlers.handleNewChat();

    expect(setSessions).not.toHaveBeenCalled();
  });

  it("creates a conversation when the active one already has messages", () => {
    const setSessions = vi.fn();
    const model = {
      id: "m1",
      providerId: "p1",
      providerName: "P",
      name: "M",
    } as unknown as NonNullable<ReturnType<HandlerArgs["modelIndex"]["get"]>>;
    const current = {
      id: "s1",
      messages: [{ id: "u1", role: "user", content: "hi" }],
      isArchived: false,
    } as unknown as ChatSession;
    const handlers = callHandlers({
      sessions: [current],
      activeSessionId: "s1",
      setSessions,
      modelIndex: new Map([["m1", model]]) as HandlerArgs["modelIndex"],
      providerGroups: [{ providerId: "p1", providerName: "P", models: [model] }] as HandlerArgs["providerGroups"],
    });

    handlers.handleNewChat();

    expect(setSessions).toHaveBeenCalledTimes(1);
  });
});
