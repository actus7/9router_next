"use client";

import { useRef, useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import type {
  ChatAttachment,
  ChatProject,
  ChatSession,
  NormalizedModel,
  ProviderGroup,
} from "../types";
import { useSessionDerived } from "./useSessionDerived";
import { useSessionHandlers } from "./useSessionHandlers";
import { useSessionPersistence } from "./useSessionPersistence";

interface UseChatSessionsArgs {
  providerGroups: ProviderGroup[];
  loadingData: boolean;
  modelIndex: Map<string, NormalizedModel>;
}

export interface UseChatSessionsReturn {
  isHydrated: boolean;
  apiKey: string;
  providerGroups: ProviderGroup[];
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
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  historySearch: string;
  setHistorySearch: React.Dispatch<React.SetStateAction<string>>;
  showArchived: boolean;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  newProjectName: string;
  setNewProjectName: React.Dispatch<React.SetStateAction<string>>;
  isCreatingProject: boolean;
  setIsCreatingProject: React.Dispatch<React.SetStateAction<boolean>>;
  systemPrompt: string;
  setSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  temperature: number;
  setTemperature: React.Dispatch<React.SetStateAction<number>>;
  reasoningEffort: "low" | "medium" | "high" | null;
  setReasoningEffort: React.Dispatch<
    React.SetStateAction<"low" | "medium" | "high" | null>
  >;
  conversationDisplay: "normal" | "compact";
  setConversationDisplay: React.Dispatch<
    React.SetStateAction<"normal" | "compact">
  >;
  enterBehavior: "queue" | "steer";
  setEnterBehavior: React.Dispatch<React.SetStateAction<"queue" | "steer">>;
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
  dndSensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  handleDragEnd: (event: DragEndEvent) => void;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  ensureSessionForModel: (
    model: NormalizedModel | null,
  ) => ChatSession | undefined;
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
  handleAttachFiles: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  removeAttachment: (attachmentId: string) => void;
}

export function useChatSessions({
  providerGroups,
  loadingData,
  modelIndex,
}: UseChatSessionsArgs): UseChatSessionsReturn {
  // State
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [reasoningEffort, setReasoningEffort] = useState<
    "low" | "medium" | "high" | null
  >(null);
  const [conversationDisplay, setConversationDisplay] = useState<
    "normal" | "compact"
  >("compact");
  const [enterBehavior, setEnterBehavior] = useState<"queue" | "steer">(
    "queue",
  );
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const serverSessionsReadyRef = useRef(false);
  const serverSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persistence: hydration, server fetch/sync, API key, model fallback, init
  useSessionPersistence({
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
  });

  // Derived: memos, grouping, DnD, UI effects
  const derived = useSessionDerived({
    providerGroups,
    modelIndex,
    sessions,
    setSessions,
    projects,
    activeProjectId,
    activeSessionId,
    activeProviderId,
    activeModelId,
    historySearch,
    showArchived,
    selectedSessionIds,
    renamingSessionId,
    setHistoryOpen,
    historyMenuRef,
    renameInputRef,
  });

  // Handlers: CRUD, model selection, attachments, rename/delete/bulk
  const handlers = useSessionHandlers({
    providerGroups,
    modelIndex,
    sessions,
    setSessions,
    projects,
    setProjects,
    activeSessionId,
    setActiveSessionId,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    activeProjectId,
    setActiveProjectId,
    setDraft,
    setAttachments,
    setHistoryOpen,
    newProjectName,
    setNewProjectName,
    setIsCreatingProject,
    setRenamingSessionId,
    setRenameValue,
    renameValue,
    selectedSessionIds,
    setSelectedSessionIds,
    filteredSessionItems: derived.filteredSessionItems,
    allVisibleSessionsSelected: derived.allVisibleSessionsSelected,
    fileInputRef,
  });

  return {
    isHydrated,
    apiKey,
    providerGroups,
    sessions,
    setSessions,
    projects,
    activeProjectId,
    activeSessionId,
    setActiveSessionId,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    draft,
    setDraft,
    attachments,
    setAttachments,
    fileInputRef,
    historyOpen,
    setHistoryOpen,
    sidebarOpen,
    setSidebarOpen,
    historySearch,
    setHistorySearch,
    showArchived,
    setShowArchived,
    newProjectName,
    setNewProjectName,
    isCreatingProject,
    setIsCreatingProject,
    systemPrompt,
    setSystemPrompt,
    temperature,
    setTemperature,
    reasoningEffort,
    setReasoningEffort,
    conversationDisplay,
    setConversationDisplay,
    enterBehavior,
    setEnterBehavior,
    renamingSessionId,
    setRenamingSessionId,
    renameValue,
    setRenameValue,
    selectedSessionIds,
    historyMenuRef,
    renameInputRef,
    ...derived,
    ...handlers,
  };
}
