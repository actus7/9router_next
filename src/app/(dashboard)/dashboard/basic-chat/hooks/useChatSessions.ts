"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import {
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { cloneSession, createId, fileToDataUrl, getDateGroup, safeParse } from "../chatFormatUtils";
import type { ChatAttachment, ChatProject, ChatSession, NormalizedModel, ProviderGroup } from "../types";

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
  systemPrompt: "basic-chat.systemPrompt",
  temperature: "basic-chat.temperature",
  projects: "basic-chat.projects",
  activeProjectId: "basic-chat.activeProjectId",
  sidebarOpen: "basic-chat.sidebarOpen",
};

const DATE_GROUP_ORDER = ["Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias", "Anteriores"];

interface UseChatSessionsArgs {
  providerGroups: ProviderGroup[];
  loadingData: boolean;
  modelIndex: Map<string, NormalizedModel>;
}

export interface UseChatSessionsReturn {
  isHydrated: boolean;
  apiKey: string;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  projects: ChatProject[];
  activeProjectId: string;
  activeSessionId: string;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  activeModelId: string;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: ChatAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  modelMenuOpen: boolean;
  setModelMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  historySearch: string;
  setHistorySearch: React.Dispatch<React.SetStateAction<string>>;
  newProjectName: string;
  setNewProjectName: React.Dispatch<React.SetStateAction<string>>;
  isCreatingProject: boolean;
  setIsCreatingProject: React.Dispatch<React.SetStateAction<boolean>>;
  systemPrompt: string;
  setSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  temperature: number;
  setTemperature: React.Dispatch<React.SetStateAction<number>>;
  showSettings: boolean;
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
  renamingSessionId: string;
  setRenamingSessionId: React.Dispatch<React.SetStateAction<string>>;
  renameValue: string;
  setRenameValue: React.Dispatch<React.SetStateAction<string>>;
  selectedSessionIds: Set<string>;
  historyMenuRef: React.RefObject<HTMLDivElement | null>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  activeProviderGroup: ProviderGroup | null;
  activeModel: NormalizedModel | null;
  currentSession: ChatSession | null;
  currentMessages: ChatSession["messages"];
  activeProject: ChatProject | null;
  sessionItems: ChatSession[];
  projectSessionCounts: Map<string, number>;
  filteredSessionItems: ChatSession[];
  groupedSessionItems: Array<{ label: string; items: ChatSession[] }>;
  selectedSessionCount: number;
  allVisibleSessionsSelected: boolean;
  dndSensors: ReturnType<typeof useSensors>;
  handleDragEnd: (event: DragEndEvent) => void;
  updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
  ensureSessionForModel: (model: NormalizedModel | null) => ChatSession | undefined;
  handleNewChat: () => void;
  handleSelectSession: (sessionId: string) => void;
  handleCreateProject: () => void;
  handleSelectProject: (projectId: string) => void;
  handleDeleteSession: (sessionId: string) => void;
  handleBulkDeleteSessions: () => void;
  toggleSessionSelected: (event: React.MouseEvent, sessionId: string) => void;
  toggleAllVisibleSessions: () => void;
  startRenameSession: (event: React.MouseEvent, session: ChatSession) => void;
  commitRenameSession: (sessionId: string) => void;
  handleSelectModel: (modelId: string) => void;
  handleAttachFiles: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeAttachment: (attachmentId: string) => void;
}

// Owns everything about chat sessions/projects: browser-cache + server
// persistence, session/project CRUD, drag & drop reordering, active
// session/provider/model selection, plus the small amount of composer and
// settings UI state (draft, attachments, system prompt, temperature) that is
// persisted alongside sessions in the same effect.
export function useChatSessions({ providerGroups, loadingData, modelIndex }: UseChatSessionsArgs): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [activeProviderId, setActiveProviderId] = useState("");
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [showSettings, setShowSettings] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const serverSessionsReadyRef = useRef(false);
  const serverSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const savedSessions = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
      if (Array.isArray(savedSessions)) {
        setSessions(savedSessions.map((session) => ({
          ...session,
          messages: Array.isArray(session?.messages) ? session.messages : [],
        })) as ChatSession[]);
      }
      const savedProjects = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.projects), []);
      if (Array.isArray(savedProjects)) {
        setProjects(savedProjects.filter((project): project is ChatProject => Boolean(project && typeof project.id === "string" && typeof project.title === "string")));
      }
      setActiveProjectId(globalThis.localStorage.getItem(STORAGE_KEYS.activeProjectId) || "");
      setActiveSessionId(globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "");
      setActiveProviderId(globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "");
      setDraft(globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "");
      setSidebarOpen(globalThis.localStorage.getItem(STORAGE_KEYS.sidebarOpen) !== "false");
      setSystemPrompt(globalThis.localStorage.getItem(STORAGE_KEYS.systemPrompt) || "");
      const savedTemperature = Number(globalThis.localStorage.getItem(STORAGE_KEYS.temperature));
      if (Number.isFinite(savedTemperature) && savedTemperature >= 0 && savedTemperature <= 2) setTemperature(savedTemperature);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // The browser cache remains a fast offline draft, while the server is the
  // durable session source used by the harness event log and later recovery.
  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    void fetch("/api/harness/sessions", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Failed to load harness sessions")))
      .then((data: Record<string, unknown>) => {
        if (cancelled) return;
        const remote = Array.isArray(data.sessions) ? data.sessions : [];
        if (remote.length > 0) {
          setSessions(remote.map((session) => ({ ...session, messages: Array.isArray(session?.messages) ? session.messages : [] })) as ChatSession[]);
        }
      })
      .catch(() => {
        // Keep local drafts usable when the durable store is temporarily unavailable.
      })
      .finally(() => { serverSessionsReadyRef.current = true; });
    return () => { cancelled = true; };
  }, [isHydrated]);

  useEffect(() => {
    let cancelled = false;

    async function loadOrCreateApiKey() {
      try {
        const res = await fetch("/api/keys", { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        const keys = Array.isArray(data.keys) ? (data.keys as Array<{ key: string }>) : [];
        if (keys[0]?.key) {
          if (!cancelled) setApiKey(keys[0].key);
          return;
        }

        const created = await fetch("/api/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Basic Chat" }),
        });
        const createdData = await created.json().catch(() => ({})) as Record<string, unknown>;
        if (!cancelled && typeof createdData.key === "string") setApiKey(createdData.key);
      } catch {
        // Ignore — the chat request will surface a clear "Missing API key" error if this fails.
      }
    }

    loadOrCreateApiKey();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (renamingSessionId) renameInputRef.current?.focus();
  }, [renamingSessionId]);

  const activeProviderGroup = useMemo(() => {
    return providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0] || null;
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId) ?? null;
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId) ?? null;
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [activeModelId, modelIndex, activeProviderGroup, sessions, activeSessionId]);

  // A session may reference a model that was subsequently disabled, exhausted,
  // or removed by its provider. Keep its historical metadata intact, but never
  // send a new turn through that stale selection.
  useEffect(() => {
    if (loadingData || providerGroups.length === 0) return;
    if (activeModelId && modelIndex.has(activeModelId)) return;
    const fallback = activeProviderGroup?.models[0] || providerGroups[0]?.models[0];
    if (!fallback) return;
    setActiveProviderId(fallback.providerId);
    setActiveModelId(fallback.id);
  }, [loadingData, providerGroups, modelIndex, activeModelId, activeProviderGroup]);

  const currentSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];
  const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId) || null, [projects, activeProjectId]);
  const sessionItems = useMemo(() => sessions
    .filter((session) => !activeProjectId || session.projectId === activeProjectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions, activeProjectId]);
  const projectSessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (session.projectId) counts.set(session.projectId, (counts.get(session.projectId) || 0) + 1);
    }
    return counts;
  }, [sessions]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSessions((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const filteredSessionItems = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return sessionItems;
    return sessionItems.filter((session) => session.title.toLowerCase().includes(q));
  }, [sessionItems, historySearch]);

  const groupedSessionItems = useMemo(() => {
    const groupMap = new Map<string, ChatSession[]>();
    for (const session of filteredSessionItems) {
      const group = getDateGroup(session.updatedAt);
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(session);
    }
    return DATE_GROUP_ORDER
      .map((label) => ({ label, items: groupMap.get(label) || [] }))
      .filter((group) => group.items.length > 0);
  }, [filteredSessionItems]);

  const selectedSessionCount = selectedSessionIds.size;
  const allVisibleSessionsSelected = filteredSessionItems.length > 0 && filteredSessionItems.every((session) => selectedSessionIds.has(session.id));

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
      globalThis.localStorage.setItem(STORAGE_KEYS.systemPrompt, systemPrompt);
      globalThis.localStorage.setItem(STORAGE_KEYS.temperature, String(temperature));
      globalThis.localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(projects));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProjectId, activeProjectId);
      globalThis.localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(sidebarOpen));
    } catch {
      // Ignore storage errors.
    }
  }, [isHydrated, sessions, activeSessionId, activeProviderId, draft, systemPrompt, temperature, projects, activeProjectId, sidebarOpen]);

  useEffect(() => {
    if (!isHydrated || !serverSessionsReadyRef.current) return;
    if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = setTimeout(() => {
      void fetch("/api/harness/sessions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessions }),
      }).catch(() => {
        // The local copy remains intact; a later state transition retries sync.
      });
    }, 350);
    return () => {
      if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    };
  }, [isHydrated, sessions]);

  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider = providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0];
    const savedModel = activeModelId && modelIndex.has(activeModelId)
      ? modelIndex.get(activeModelId)!
      : savedProvider.models[0];

    if (sessions.length > 0) {
      const session = sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel = session?.modelId && modelIndex.has(session.modelId)
        ? modelIndex.get(session.modelId)!
        : savedModel;
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
    setSessions([session]);
    setActiveSessionId(session.id);
    setActiveProviderId(savedProvider.providerId);
    setActiveModelId(savedModel.id);
  }, [isHydrated, loadingData, providerGroups, modelIndex, sessions, activeSessionId, activeProviderId, activeModelId, activeProjectId]);

  const updateSession = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  }, []);

  const ensureSessionForModel = useCallback((model: NormalizedModel | null): ChatSession | undefined => {
    if (!model) return undefined;
    return {
      id: createId(),
      title: translate("New conversation") || "New conversation",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: activeProjectId || undefined,
      messages: [],
    };
  }, [activeProjectId]);

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
  };

  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
  };

  const handleCreateProject = () => {
    const title = newProjectName.trim().replace(/\s+/g, " ");
    if (!title) return;
    const now = new Date().toISOString();
    const project = { id: createId(), title: title.slice(0, 80), createdAt: now, updatedAt: now };
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setNewProjectName("");
    setIsCreatingProject(false);
    setSelectedSessionIds(new Set());
  };

  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setSelectedSessionIds(new Set());
  };

  const handleDeleteSession = (sessionId: string) => {
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    setSessions(nextSessions);
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    if (activeSessionId === sessionId) {
      const fallback = nextSessions[0] || null;
      if (fallback) {
        setActiveSessionId(fallback.id);
        setActiveProviderId(fallback.providerId);
        setActiveModelId(fallback.modelId);
      } else {
        setActiveSessionId("");
        setActiveProviderId("");
        setActiveModelId("");
      }
    }
  };

  const handleBulkDeleteSessions = () => {
    const ids = selectedSessionIds;
    if (ids.size === 0) return;
    const nextSessions = sessions.filter((session) => !ids.has(session.id));
    setSessions(nextSessions);
    if (activeSessionId && ids.has(activeSessionId)) {
      const fallback = nextSessions[0] || null;
      setActiveSessionId(fallback?.id || "");
      setActiveProviderId(fallback?.providerId || "");
      setActiveModelId(fallback?.modelId || "");
    }
    setSelectedSessionIds(new Set());
  };

  const toggleSessionSelected = (event: React.MouseEvent, sessionId: string) => {
    event.stopPropagation();
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const toggleAllVisibleSessions = () => {
    setSelectedSessionIds((prev) => {
      if (allVisibleSessionsSelected) return new Set();
      const next = new Set(prev);
      filteredSessionItems.forEach((session) => next.add(session.id));
      return next;
    });
  };

  const startRenameSession = (event: React.MouseEvent, session: ChatSession) => {
    event.stopPropagation();
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
  };

  const commitRenameSession = (sessionId: string) => {
    const title = renameValue.trim();
    if (title) {
      setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, title } : session)));
    }
    setRenamingSessionId("");
  };

  const handleSelectModel = (modelId: string) => {
    const model = modelIndex.get(modelId);
    if (!model) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        modelName: model.name,
      } : item)));
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
  };

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      event.target.value = "";
      return;
    }

    const converted = await Promise.all(images.map(async (file) => ({
      id: createId(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    })));

    setAttachments((prev) => [...prev, ...converted]);
    event.target.value = "";
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  return {
    isHydrated, apiKey, sessions, setSessions, projects, activeProjectId, activeSessionId, setActiveSessionId,
    activeProviderId, setActiveProviderId, activeModelId, setActiveModelId, draft, setDraft, attachments, setAttachments,
    fileInputRef, modelMenuOpen, setModelMenuOpen, historyOpen, setHistoryOpen, sidebarOpen, setSidebarOpen,
    historySearch, setHistorySearch, newProjectName, setNewProjectName, isCreatingProject, setIsCreatingProject,
    systemPrompt, setSystemPrompt, temperature, setTemperature, showSettings, setShowSettings,
    renamingSessionId, setRenamingSessionId, renameValue, setRenameValue, selectedSessionIds, historyMenuRef, renameInputRef,
    activeProviderGroup, activeModel, currentSession, currentMessages, activeProject, sessionItems, projectSessionCounts,
    filteredSessionItems, groupedSessionItems, selectedSessionCount, allVisibleSessionsSelected, dndSensors, handleDragEnd,
    updateSession, ensureSessionForModel, handleNewChat, handleSelectSession, handleCreateProject, handleSelectProject,
    handleDeleteSession, handleBulkDeleteSessions, toggleSessionSelected, toggleAllVisibleSessions, startRenameSession,
    commitRenameSession, handleSelectModel, handleAttachFiles, removeAttachment,
  };
}
