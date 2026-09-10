import { useCallback, useEffect, useRef } from "react";
import { translate } from "@/i18n/runtime";
import { notify } from "@/store/notificationStore";
import { ensureBuiltinMcpServers } from "@/shared/harness/builtinMcpServers";
import { FREE_DEFAULT_MODEL_KEY } from "@/shared/constants/freeDefault";
import { createId } from "../chatFormatUtils";
import type {
  ChatProject,
  ChatSession,
  NormalizedModel,
  ProviderGroup,
} from "../types";
import { hydrateFromStorage, persistToStorage } from "./chatSessionStorage";
import { discoverTools, normalizeDiscoveredTools } from "./useMcpServers";

const CONTEXT7_SERVER_ID = "builtin-context7";

export interface UseSessionPersistenceArgs {
  providerGroups: ProviderGroup[];
  loadingData: boolean;
  modelIndex: Map<string, NormalizedModel>;
  // State values
  sessions: ChatSession[];
  activeSessionId: string;
  activeProviderId: string;
  activeModelId: string;
  activeProjectId: string;
  draft: string;
  systemPrompt: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high" | null;
  projects: ChatProject[];
  sidebarOpen: boolean;
  conversationDisplay: "normal" | "compact";
  enterBehavior: "queue" | "steer";
  isHydrated: boolean;
  // State setters
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setProjects: React.Dispatch<React.SetStateAction<ChatProject[]>>;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string>>;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setApiKey: React.Dispatch<React.SetStateAction<string>>;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  setTemperature: React.Dispatch<React.SetStateAction<number>>;
  setReasoningEffort: React.Dispatch<
    React.SetStateAction<"low" | "medium" | "high" | null>
  >;
  setConversationDisplay: React.Dispatch<
    React.SetStateAction<"normal" | "compact">
  >;
  setEnterBehavior: React.Dispatch<React.SetStateAction<"queue" | "steer">>;
  setIsHydrated: React.Dispatch<React.SetStateAction<boolean>>;
  // Refs
  initializedRef: React.MutableRefObject<boolean>;
  serverSessionsReadyRef: React.MutableRefObject<boolean>;
  serverSyncTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
}

export function useSessionPersistence(args: UseSessionPersistenceArgs): void {
  const {
    providerGroups,
    loadingData,
    modelIndex,
    sessions,
    activeSessionId,
    activeProviderId,
    activeModelId,
    activeProjectId,
    draft,
    systemPrompt,
    temperature,
    reasoningEffort,
    projects,
    sidebarOpen,
    conversationDisplay,
    enterBehavior,
    isHydrated,
    setSessions,
    setProjects,
    setActiveProjectId,
    setActiveSessionId,
    setActiveProviderId,
    setActiveModelId,
    setDraft,
    setApiKey,
    setSidebarOpen,
    setSystemPrompt,
    setTemperature,
    setReasoningEffort,
    setConversationDisplay,
    setEnterBehavior,
    setIsHydrated,
    initializedRef,
    serverSessionsReadyRef,
    serverSyncTimerRef,
  } = args;

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const saved = hydrateFromStorage();
      setSessions(saved.sessions.map(ensureBuiltinMcpServers));
      setProjects(saved.projects);
      setActiveProjectId(saved.activeProjectId);
      setActiveSessionId(saved.activeSessionId);
      setActiveProviderId(saved.activeProviderId);
      setActiveModelId(saved.activeModelId);
      setDraft(saved.draft);
      setSidebarOpen(saved.sidebarOpen);
      setSystemPrompt(saved.systemPrompt);
      setTemperature(saved.temperature);
      setReasoningEffort(saved.reasoningEffort);
      setConversationDisplay(saved.conversationDisplay);
      setEnterBehavior(saved.enterBehavior);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    } finally {
      setIsHydrated(true);
    }
  }, [
    setActiveModelId,
    setActiveProjectId,
    setActiveProviderId,
    setActiveSessionId,
    setConversationDisplay,
    setDraft,
    setEnterBehavior,
    setIsHydrated,
    setProjects,
    setReasoningEffort,
    setSessions,
    setSidebarOpen,
    setSystemPrompt,
    setTemperature,
  ]);

  /**
   * Conversation id -> the `updatedAt` the server is known to hold.
   *
   * Seeded by a successful GET and updated by every successful sync. This is
   * what makes the sync incremental and deletions explicit; an empty map means
   * nothing is known, which is why the sync stays disarmed until the GET
   * answers.
   */
  const syncedRef = useRef<Map<string, string>>(new Map());

  /**
   * Reads the server's conversations and takes them as the newer truth.
   *
   * Used on mount and again whenever a sync is refused as stale — which is how
   * a tab learns that the worker wrote a finished answer while it was idle.
   */
  const loadServerSessions = useCallback(async (isCancelled: () => boolean) => {
    const response = await fetch("/api/harness/sessions", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load harness sessions");
    const data = (await response.json()) as Record<string, unknown>;
    if (isCancelled()) return;
    const remote = Array.isArray(data.sessions) ? data.sessions : [];
    // What the server is known to hold, so the sync can send only what
    // changed and name what was removed.
    syncedRef.current = new Map(
      remote.map((session) => [String((session as ChatSession).id), String((session as ChatSession).updatedAt)]),
    );
    serverSessionsReadyRef.current = true;
    // Conversations another device deleted. Without this the merge below reads
    // "absent from the server" as "not synced yet" and re-uploads them, so a
    // deletion never converged: deleting on the desktop came back the next
    // time the phone opened the chat.
    const deleted = new Set(
      (Array.isArray(data.deletedIds) ? data.deletedIds : []).map((id) => String(id)),
    );
    const remoteSessions = remote
      .map((session) => ({
        ...session,
        messages: Array.isArray(session?.messages) ? session.messages : [],
      }))
      .map(ensureBuiltinMcpServers) as ChatSession[];
    if (remoteSessions.length === 0 && deleted.size === 0) return;
    // Merge instead of overwrite: a session created locally between hydration and
    // this fetch resolving hasn't reached the server yet and must not be discarded.
    setSessions((current) => {
      const remoteIds = new Set(remoteSessions.map((session) => session.id));
      const localOnly = current.filter(
        (session) => !remoteIds.has(session.id) && !deleted.has(session.id),
      );
      return [...remoteSessions, ...localOnly];
    });
  }, [serverSessionsReadyRef, setSessions]);

  // Fetch sessions from the durable server store
  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    void loadServerSessions(() => cancelled)
      .catch((error: unknown) => {
        // Deliberately leaves the sync disarmed. It used to be armed in a
        // `.finally`, so a transient failure here — a shared dashboard rate
        // limit, Neon Auth blinking — let the next local change PUT the local
        // state as the whole truth. Sync was destructive by omission, so on a
        // fresh browser that replaced the account's history with one empty
        // conversation, and the only sign was this warning.
        console.error("Failed to load harness sessions:", error);
        notify.warning(
          translate("Could not load saved sessions. Using local copy.") ||
            "Could not load saved sessions. Using local copy.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isHydrated, loadServerSessions]);

  // Load or create API key
  useEffect(() => {
    let cancelled = false;

    async function loadOrCreateApiKey() {
      try {
        const res = await fetch("/api/keys", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const keys = Array.isArray(data.keys)
          ? (data.keys as Array<{ key: string }>)
          : [];
        if (keys[0]?.key) {
          if (!cancelled) setApiKey(keys[0].key);
          return;
        }

        const created = await fetch("/api/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Basic Chat" }),
        });
        const createdData = (await created.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!cancelled && typeof createdData.key === "string")
          setApiKey(createdData.key);
      } catch {
        // Ignore — the chat request will surface a clear "Missing API key" error if this fails.
      }
    }

    loadOrCreateApiKey();
    return () => {
      cancelled = true;
    };
  }, [setApiKey]);

  // Model fallback: if the active model was removed/exhausted, pick the first available
  useEffect(() => {
    if (loadingData || providerGroups.length === 0) return;
    if (activeModelId && modelIndex.has(activeModelId)) return;
    const activeProviderGroup =
      providerGroups.find((group) => group.providerId === activeProviderId) ||
      providerGroups[0] ||
      null;
    // No stored choice at all means a first run: start on the credential-free
    // default so a fresh install can chat before any provider is configured.
    // When a stored model merely went away, keep the old behaviour and stay
    // near the provider the user was already on.
    const firstRun = !activeModelId;
    const fallback =
      (firstRun ? modelIndex.get(FREE_DEFAULT_MODEL_KEY) : undefined) ||
      activeProviderGroup?.models[0] || providerGroups[0]?.models[0];
    if (!fallback) return;
    setActiveProviderId(fallback.providerId);
    setActiveModelId(fallback.id);
  }, [
    loadingData,
    providerGroups,
    modelIndex,
    activeModelId,
    activeProviderId,
    setActiveProviderId,
    setActiveModelId,
  ]);

  // Initialization: pick session/model on first load when provider data arrives
  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider =
      providerGroups.find((group) => group.providerId === activeProviderId) ||
      providerGroups[0];
    const savedModel =
      activeModelId && modelIndex.has(activeModelId)
        ? modelIndex.get(activeModelId)!
        : savedProvider.models[0];

    if (sessions.length > 0) {
      const session =
        sessions.find((item) => item.id === activeSessionId) || sessions[0];
      // A session belongs to the conversation history. The active selection
      // belongs to the composer and must survive reopening that history.
      const sessionModel =
        savedModel ||
        (session?.modelId && modelIndex.has(session.modelId)
          ? modelIndex.get(session.modelId)!
          : null);
      initializedRef.current = true;
      setActiveSessionId(session.id);
      setActiveProviderId(sessionModel?.providerId || savedProvider.providerId);
      setActiveModelId(sessionModel?.id || savedModel.id);
      return;
    }

    const session: ChatSession = {
      id: createId(),
      title: translate("New conversation") || "New conversation",
      providerId: savedProvider.providerId,
      providerName: savedProvider.providerName,
      modelId: savedModel.id,
      modelName: savedModel.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: activeProjectId || undefined,
      messages: [],
    };

    initializedRef.current = true;
    setSessions([ensureBuiltinMcpServers(session)]);
    setActiveSessionId(session.id);
    setActiveProviderId(savedProvider.providerId);
    setActiveModelId(savedModel.id);
  }, [
    isHydrated,
    loadingData,
    providerGroups,
    modelIndex,
    sessions,
    activeSessionId,
    activeProviderId,
    activeModelId,
    activeProjectId,
    initializedRef,
    setSessions,
    setActiveSessionId,
    setActiveProviderId,
    setActiveModelId,
  ]);

  // Persist to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      persistToStorage({
        sessions,
        activeSessionId,
        activeProviderId,
        activeModelId,
        draft,
        systemPrompt,
        temperature,
        reasoningEffort,
        projects,
        activeProjectId,
        sidebarOpen,
        conversationDisplay,
        enterBehavior,
      });
    } catch {
      // Ignore storage errors.
    }
  }, [
    isHydrated,
    sessions,
    activeSessionId,
    activeProviderId,
    activeModelId,
    draft,
    systemPrompt,
    temperature,
    reasoningEffort,
    projects,
    activeProjectId,
    sidebarOpen,
    conversationDisplay,
    enterBehavior,
  ]);

  /**
   * Debounced server sync, incremental and explicit.
   *
   * Sends only the conversations whose `updatedAt` moved since the last
   * successful sync, and names the ones that are gone. It used to POST every
   * conversation — every message, every base64 attachment — on every keystroke
   * of a chat, and the server deleted whatever the payload left out.
   *
   * `keepalive` and the `pagehide` flush exist because the cleanup below runs
   * on unmount too: navigating to another dashboard route within the debounce
   * window cancelled the timer, and the turn that had just finished never
   * reached the server at all.
   */
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const flushServerSync = useCallback((keepalive: boolean) => {
    if (!serverSessionsReadyRef.current) return;
    const current = sessionsRef.current;
    const synced = syncedRef.current;
    const upserts = current.filter((session) => synced.get(session.id) !== session.updatedAt);
    const present = new Set(current.map((session) => session.id));
    const deletedIds = [...synced.keys()].filter((id) => !present.has(id));
    if (upserts.length === 0 && deletedIds.length === 0) return;

    // Recorded as sent before the request resolves: a failure re-sends on the
    // next change anyway, and holding the old value would re-send everything.
    const next = new Map(synced);
    for (const id of deletedIds) next.delete(id);
    for (const session of upserts) next.set(session.id, session.updatedAt);
    syncedRef.current = next;

    void fetch("/api/harness/sessions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessions: upserts, deletedIds }),
      keepalive,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Sync failed (${response.status})`);
        const body = (await response.json().catch(() => ({}))) as { stale?: unknown };
        const staleIds = Array.isArray(body.stale) ? body.stale : [];
        if (staleIds.length === 0) return;
        // The server holds something newer for these — the worker settled a run
        // and wrote the answer into the conversation while this tab was idle.
        // Take its copy instead of pushing ours again.
        await loadServerSessions(() => false);
      })
      .catch((error: unknown) => {
        console.error("Failed to sync harness sessions:", error);
        // Put them back so the next change retries instead of assuming the
        // server has what it never received.
        const rollback = new Map(syncedRef.current);
        for (const session of upserts) rollback.delete(session.id);
        for (const id of deletedIds) rollback.set(id, "");
        syncedRef.current = rollback;
        notify.warning(
          translate("Could not sync sessions to server. Changes are saved locally.") ||
            "Could not sync sessions to server. Changes are saved locally.",
        );
      });
  }, [loadServerSessions, serverSessionsReadyRef]);

  useEffect(() => {
    if (!isHydrated || !serverSessionsReadyRef.current) return;
    if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = setTimeout(() => flushServerSync(false), 350);
    return () => {
      if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    };
  }, [flushServerSync, isHydrated, serverSessionsReadyRef, serverSyncTimerRef, sessions]);

  // The last write must survive leaving the page, by either route.
  useEffect(() => {
    const onHide = () => flushServerSync(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flushServerSync(true);
    };
  }, [flushServerSync]);

  // Auto-connect Context7 (no token required): discover its tools as soon as a
  // session carries the built-in server without them, so it works out of the
  // box without the user opening Harness settings and clicking Connect.
  const context7AutoConnectAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isHydrated) return;
    for (const session of sessions) {
      const server = session.mcpServers?.find((s) => s.id === CONTEXT7_SERVER_ID);
      if (!server || server.tools.length > 0) continue;
      if (context7AutoConnectAttemptedRef.current.has(session.id)) continue;
      context7AutoConnectAttemptedRef.current.add(session.id);
      discoverTools(server.url)
        .then((payload) => {
          const tools = normalizeDiscoveredTools(payload, CONTEXT7_SERVER_ID);
          if (!tools.length) return;
          setSessions((current) =>
            current.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    mcpServers: (s.mcpServers ?? []).map((srv) =>
                      srv.id === CONTEXT7_SERVER_ID
                        ? { ...srv, tools, validatedAt: new Date().toISOString() }
                        : srv,
                    ),
                  }
                : s,
            ),
          );
        })
        .catch(() => {
          // Silent — the user can still connect manually from Harness settings.
        });
    }
  }, [isHydrated, sessions, setSessions]);
}
