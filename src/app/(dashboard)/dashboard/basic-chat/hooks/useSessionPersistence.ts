import { useEffect, useRef } from "react";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
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
  const notify = useNotificationStore();
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

  // Fetch sessions from the durable server store
  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    void fetch("/api/harness/sessions", { cache: "no-store" })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Failed to load harness sessions")),
      )
      .then((data: Record<string, unknown>) => {
        if (cancelled) return;
        const remote = Array.isArray(data.sessions) ? data.sessions : [];
        if (remote.length > 0) {
          const remoteSessions = remote
            .map((session) => ({
              ...session,
              messages: Array.isArray(session?.messages) ? session.messages : [],
            }))
            .map(ensureBuiltinMcpServers) as ChatSession[];
          // Merge instead of overwrite: a session created locally between hydration and
          // this fetch resolving hasn't reached the server yet and must not be discarded.
          setSessions((current) => {
            const remoteIds = new Set(
              remoteSessions.map((session) => session.id),
            );
            const localOnly = current.filter(
              (session) => !remoteIds.has(session.id),
            );
            return [...remoteSessions, ...localOnly];
          });
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load harness sessions:", error);
        notify.warning(
          translate("Could not load saved sessions. Using local copy.") ||
            "Could not load saved sessions. Using local copy.",
        );
      })
      .finally(() => {
        serverSessionsReadyRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [isHydrated, notify, serverSessionsReadyRef, setSessions]);

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

  // Debounced server sync
  useEffect(() => {
    if (!isHydrated || !serverSessionsReadyRef.current) return;
    if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = setTimeout(() => {
      void fetch("/api/harness/sessions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessions }),
      }).catch((error: unknown) => {
        console.error("Failed to sync harness sessions:", error);
        notify.warning(
          translate("Could not sync sessions to server. Changes are saved locally.") ||
            "Could not sync sessions to server. Changes are saved locally.",
        );
      });
    }, 350);
    return () => {
      if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    };
  }, [isHydrated, notify, serverSessionsReadyRef, serverSyncTimerRef, sessions]);

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
