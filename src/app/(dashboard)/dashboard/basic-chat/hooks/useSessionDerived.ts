import { useEffect, useMemo } from "react";
import {
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { getDateGroup } from "../chatFormatUtils";
import type { ChatProject, ChatSession, NormalizedModel, ProviderGroup } from "../types";
import { DATE_GROUP_ORDER } from "./chatSessionStorage";

export interface UseSessionDerivedArgs {
  providerGroups: ProviderGroup[];
  modelIndex: Map<string, NormalizedModel>;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  projects: ChatProject[];
  activeProjectId: string;
  activeSessionId: string;
  activeProviderId: string;
  activeModelId: string;
  historySearch: string;
  selectedSessionIds: Set<string>;
  renamingSessionId: string;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  historyMenuRef: React.RefObject<HTMLDivElement | null>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
}

export interface UseSessionDerivedReturn {
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
}

export function useSessionDerived({
  providerGroups, modelIndex, sessions, setSessions, projects, activeProjectId,
  activeSessionId, activeProviderId, activeModelId, historySearch,
  selectedSessionIds, renamingSessionId, setHistoryOpen, historyMenuRef, renameInputRef,
}: UseSessionDerivedArgs): UseSessionDerivedReturn {
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSessions((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

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

  // Close history menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus rename input when renaming starts
  useEffect(() => {
    if (renamingSessionId) renameInputRef.current?.focus();
  }, [renamingSessionId]);

  return {
    activeProviderGroup, activeModel, currentSession, currentMessages, activeProject,
    sessionItems, projectSessionCounts, filteredSessionItems, groupedSessionItems,
    selectedSessionCount, allVisibleSessionsSelected, dndSensors, handleDragEnd,
  };
}
