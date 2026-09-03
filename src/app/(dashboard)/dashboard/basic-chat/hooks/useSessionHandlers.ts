import { useCallback } from "react";
import { translate } from "@/i18n/runtime";
import { cloneSession, createId, fileToDataUrl } from "../chatFormatUtils";
import type { ChatAttachment, ChatProject, ChatSession, NormalizedModel, ProviderGroup } from "../types";

const LAST_SELECTED_MODEL_KEY = "basic-chat.lastSelectedModelId";

function getLastSelectedModelId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_SELECTED_MODEL_KEY) || "";
  } catch {
    return "";
  }
}

function persistLastSelectedModelId(modelId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SELECTED_MODEL_KEY, modelId);
  } catch {
    // Storage is only a convenience; a new chat still has a deterministic fallback.
  }
}

export function resolveNewChatModel(
  lastSelectedModelId: string,
  modelIndex: Map<string, NormalizedModel>,
  providerGroups: ProviderGroup[],
): NormalizedModel | null {
  return modelIndex.get(lastSelectedModelId)
    || providerGroups.flatMap((group) => group.models)[0]
    || null;
}

export interface UseSessionHandlersArgs {
  providerGroups: ProviderGroup[];
  modelIndex: Map<string, NormalizedModel>;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  projects: ChatProject[];
  setProjects: React.Dispatch<React.SetStateAction<ChatProject[]>>;
  activeSessionId: string;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  activeModelId: string;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  activeProjectId: string;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string>>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  setAttachmentNotice: React.Dispatch<React.SetStateAction<string>>;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newProjectName: string;
  setNewProjectName: React.Dispatch<React.SetStateAction<string>>;
  setIsCreatingProject: React.Dispatch<React.SetStateAction<boolean>>;
  renamingSessionId: string;
  setRenamingSessionId: React.Dispatch<React.SetStateAction<string>>;
  setRenameValue: React.Dispatch<React.SetStateAction<string>>;
  renameValue: string;
  selectedSessionIds: Set<string>;
  setSelectedSessionIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  filteredSessionItems: ChatSession[];
  allVisibleSessionsSelected: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export interface UseSessionHandlersReturn {
  updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
  ensureSessionForModel: (model: NormalizedModel | null) => ChatSession | undefined;
  handleNewChat: () => void;
  handleSelectSession: (sessionId: string) => void;
  handleCreateProject: () => void;
  handleSelectProject: (projectId: string) => void;
  handleRenameProject: (projectId: string, title: string) => void;
  handleDeleteProject: (projectId: string) => void;
  handleDeleteSession: (sessionId: string) => void;
  handleBulkDeleteSessions: () => void;
  handleToggleArchiveSession: (sessionId: string) => void;
  toggleSessionSelected: (event: React.MouseEvent, sessionId: string) => void;
  toggleAllVisibleSessions: () => void;
  startRenameSession: (event: React.MouseEvent, session: ChatSession) => void;
  commitRenameSession: (sessionId: string) => void;
  handleSelectModel: (modelId: string) => void;
  handleSelectProvider: (providerId: string) => void;
  handleAttachFiles: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeAttachment: (attachmentId: string) => void;
}

export function useSessionHandlers({
  providerGroups, modelIndex, sessions, setSessions,
  setProjects,
  activeSessionId, setActiveSessionId, activeProviderId, setActiveProviderId,
  activeModelId, setActiveModelId, activeProjectId, setActiveProjectId,
  setDraft, setAttachments, setAttachmentNotice, setHistoryOpen,
  newProjectName, setNewProjectName, setIsCreatingProject,
  renamingSessionId, setRenamingSessionId, setRenameValue, renameValue,
  selectedSessionIds, setSelectedSessionIds,
  filteredSessionItems, allVisibleSessionsSelected,
}: UseSessionHandlersArgs): UseSessionHandlersReturn {
  const updateSession = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  }, [setSessions]);

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
    setDraft("");
    setAttachments([]);
    setAttachmentNotice("");
    setHistoryOpen(false);

    // Repeated clicks used to pile up interchangeable "New conversation"
    // rows in the history. An empty active conversation already is a new chat.
    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length === 0 && !current.isArchived) return;

    const model = resolveNewChatModel(getLastSelectedModelId(), modelIndex, providerGroups);
    if (!model) return;
    const session = ensureSessionForModel(model);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
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

  const handleRenameProject = (projectId: string, rawTitle: string) => {
    const title = rawTitle.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!title) return;
    const updatedAt = new Date().toISOString();
    setProjects((current) => current.map((project) => (
      project.id === projectId ? { ...project, title, updatedAt } : project
    )));
  };

  const handleDeleteProject = (projectId: string) => {
    const nextSessions = sessions.filter((session) => session.projectId !== projectId);
    const removedSessionIds = new Set(
      sessions.filter((session) => session.projectId === projectId).map((session) => session.id),
    );

    setProjects((current) => current.filter((project) => project.id !== projectId));
    setSessions(nextSessions);
    setSelectedSessionIds((current) => new Set([...current].filter((id) => !removedSessionIds.has(id))));
    if (activeProjectId === projectId) setActiveProjectId("");

    if (removedSessionIds.has(activeSessionId)) {
      const fallback = nextSessions[0] || null;
      setActiveSessionId(fallback?.id || "");
      setActiveProviderId(fallback?.providerId || "");
      setActiveModelId(fallback?.modelId || "");
    }
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

  const handleToggleArchiveSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const archiving = !session.isArchived;
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? { ...item, isArchived: archiving } : item)));
    if (archiving && activeSessionId === sessionId) {
      const fallback = sessions.find((item) => item.id !== sessionId && !item.isArchived) || null;
      setActiveSessionId(fallback?.id || "");
      setActiveProviderId(fallback?.providerId || "");
      setActiveModelId(fallback?.modelId || "");
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
    // Escape clears the renaming id before the field blurs. Blur then reaches
    // here with a value the user already discarded, so ignore it.
    if (renamingSessionId !== sessionId) return;
    const title = renameValue.trim();
    if (title) {
      setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, title } : session)));
    }
    setRenamingSessionId("");
  };

  const handleSelectModel = (modelId: string) => {
    // The picker renders from providerGroups. During a catalogue refresh its
    // click can arrive between the groups render and the derived Map update;
    // resolve from the rendered source as a safe fallback instead of silently
    // closing the picker and leaving the composer with no active model.
    const model = modelIndex.get(modelId)
      ?? providerGroups.flatMap((group) => group.models).find((candidate) => candidate.id === modelId);
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
    persistLastSelectedModelId(model.id);
  };

  const handleSelectProvider = (providerId: string) => {
    const provider = providerGroups.find((group) => group.providerId === providerId);
    if (!provider?.models.length) return;

    // Keep the currently selected model whenever it exists for the provider;
    // otherwise use that provider's first enabled model. No failed or hidden
    // model can leak back in through a conversation history entry.
    const model = provider.models.find((item) => item.id === activeModelId) || provider.models[0];
    handleSelectModel(model.id);
  };

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    const rejected = files.length - images.length;
    setAttachmentNotice(
      rejected > 0
        ? translate("Only image files can be attached.") || "Only image files can be attached."
        : "",
    );
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
    updateSession, ensureSessionForModel, handleNewChat, handleSelectSession,
    handleCreateProject, handleSelectProject, handleRenameProject, handleDeleteProject,
    handleDeleteSession, handleBulkDeleteSessions, handleToggleArchiveSession,
    toggleSessionSelected, toggleAllVisibleSessions, startRenameSession, commitRenameSession,
    handleSelectModel, handleSelectProvider, handleAttachFiles, removeAttachment,
  };
}
