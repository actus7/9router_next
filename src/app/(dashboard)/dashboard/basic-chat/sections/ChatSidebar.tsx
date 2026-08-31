"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { translate } from "@/i18n/runtime";
import {
  DndContext, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2, Download, FolderKanban, GripVertical, Pencil, Plus, Search, Trash2,
} from "lucide-react";
import { formatRelativeTime } from "../chatFormatUtils";
import type { ChatProject, ChatSession } from "../types";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";

interface SortableSessionItemProps {
  session: ChatSession;
  isActive: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  selectedCount: number;
  onSelect: (id: string) => void;
  onToggleSelect: (e: React.MouseEvent, id: string) => void;
  onStartRename: (e: React.MouseEvent, session: ChatSession) => void;
  onCommitRename: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameChange: (value: string) => void;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
}

function SortableSessionItem({
  session, isActive, isSelected, isRenaming, renameValue, selectedCount,
  onSelect, onToggleSelect, onStartRename, onCommitRename, onDelete, onRenameChange, renameInputRef,
}: SortableSessionItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: session.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => { if (!isRenaming) onSelect(session.id); }}
      onKeyDown={(e) => { if (!isRenaming && e.key === "Enter") onSelect(session.id); }}
      className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm transition-all hover:bg-muted ${isActive ? "bg-muted" : ""} ${isDragging ? "z-50" : ""}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <button
        type="button"
        onClick={(e) => onToggleSelect(e, session.id)}
        className={`shrink-0 items-center justify-center rounded border transition-all ${
          isSelected || selectedCount > 0 ? "flex size-3.5 border-border bg-background" : "hidden group-hover:flex group-hover:size-3.5 group-hover:border-border group-hover:bg-background"
        } ${isSelected ? "border-primary bg-primary text-primary-foreground" : ""}`}
      >
        {isSelected ? <CheckCircle2 className="size-2.5" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <input ref={renameInputRef} value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onCommitRename(session.id); if (e.key === "Escape") onCommitRename(""); }} onBlur={() => onCommitRename(session.id)} className="h-5 w-full rounded border border-border bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
        ) : (
          <>
            <p className="truncate text-xs font-medium text-card-foreground">{session.title}</p>
            <p className="text-[10px] text-muted-foreground">{formatRelativeTime(session.updatedAt)}</p>
          </>
        )}
      </div>
      {!isRenaming && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" type="button" onClick={(e: React.MouseEvent) => onStartRename(e, session)} className="size-5"><Pencil className="size-2.5" /></Button>
          <Button variant="ghost" size="icon-sm" type="button" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(session.id); }} className="size-5 text-destructive hover:text-destructive"><Trash2 className="size-2.5" /></Button>
        </div>
      )}
    </div>
  );
}

interface ChatSidebarProps {
  sessionsHook: UseChatSessionsReturn;
  onExport: (format: "json" | "markdown") => void;
}

export default function ChatSidebar({ sessionsHook, onExport }: ChatSidebarProps) {
  const {
    sidebarOpen, projects, activeProjectId, sessions, projectSessionCounts, isCreatingProject, newProjectName,
    setNewProjectName, handleCreateProject, setIsCreatingProject, handleSelectProject, handleRenameProject,
    handleDeleteProject, handleNewChat, activeModel,
    historySearch, setHistorySearch, selectedSessionCount, allVisibleSessionsSelected,
    toggleAllVisibleSessions, handleBulkDeleteSessions, groupedSessionItems, dndSensors, handleDragEnd,
    filteredSessionItems, activeSessionId, selectedSessionIds, renamingSessionId, setRenamingSessionId, renameValue,
    handleSelectSession, toggleSessionSelected, startRenameSession, commitRenameSession, handleDeleteSession,
    setRenameValue, renameInputRef,
  } = sessionsHook;
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<ChatProject | null>(null);

  const onDragEnd = (event: DragEndEvent) => handleDragEnd(event);
  const startRenameProject = (event: React.MouseEvent, project: ChatProject) => {
    event.stopPropagation();
    setRenamingProjectId(project.id);
    setProjectTitle(project.title);
  };
  const commitRenameProject = (projectId: string) => {
    handleRenameProject(projectId, projectTitle);
    setRenamingProjectId("");
  };
  const projectSessionCount = projectPendingDeletion
    ? projectSessionCounts.get(projectPendingDeletion.id) || 0
    : 0;

  return (
    <aside className={`order-2 w-72 shrink-0 flex-col border-l border-border bg-card/50 min-h-0 xl:w-80 ${sidebarOpen ? "hidden md:flex" : "hidden"}`}>
      <div className="shrink-0 border-b border-border px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{translate("Projects") || "Projects"}</h2>
          <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Create project") || "Create project"} onClick={() => setIsCreatingProject((value) => !value)} className="size-7">
            <Plus className="size-3.5" />
          </Button>
        </div>
        {isCreatingProject ? (
          <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); handleCreateProject(); }}>
            <Input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={80} placeholder={translate("Project name") || "Project name"} className="h-8 min-w-0 text-xs" />
            <Button type="submit" size="sm" className="h-8 px-2 text-xs" disabled={!newProjectName.trim()}>{translate("Add") || "Add"}</Button>
          </form>
        ) : null}
        <div className="mt-1 space-y-0.5" role="list" aria-label={translate("Projects") || "Projects"}>
          <button type="button" onClick={() => handleSelectProject("")} aria-pressed={!activeProjectId} className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${!activeProjectId ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <FolderKanban className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{translate("All conversations") || "All conversations"}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{sessions.length}</span>
          </button>
          {projects.map((project) => {
            const isRenaming = renamingProjectId === project.id;
            const sessionCount = projectSessionCounts.get(project.id) || 0;
            return (
              <div key={project.id} className={`group flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors ${activeProjectId === project.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                {isRenaming ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <FolderKanban className="size-3.5 shrink-0" />
                    <Input
                      autoFocus
                      value={projectTitle}
                      onChange={(event) => setProjectTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRenameProject(project.id);
                        if (event.key === "Escape") setRenamingProjectId("");
                      }}
                      onBlur={() => commitRenameProject(project.id)}
                      maxLength={80}
                      className="h-6 min-w-0 px-1 text-xs"
                    />
                  </div>
                ) : (
                  <button type="button" onClick={() => handleSelectProject(project.id)} aria-pressed={activeProjectId === project.id} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <FolderKanban className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  </button>
                )}
                {!isRenaming ? (
                  <>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{sessionCount}</span>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <Button variant="ghost" size="icon-sm" type="button" onClick={(event) => startRenameProject(event, project)} aria-label={`${translate("Rename project") || "Rename project"}: ${project.title}`} className="size-5">
                        <Pencil className="size-2.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" type="button" onClick={(event) => { event.stopPropagation(); setProjectPendingDeletion(project); }} aria-label={`${translate("Delete project") || "Delete project"}: ${project.title}`} className="size-5 text-destructive hover:text-destructive">
                        <Trash2 className="size-2.5" />
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <Dialog open={Boolean(projectPendingDeletion)} onOpenChange={(open) => { if (!open) setProjectPendingDeletion(null); }}>
        <DialogContent showCloseButton={false} className="gap-4 p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>{translate("Delete project?") || "Delete project?"}</DialogTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              {(translate("Deleting this project permanently removes all of its conversations and messages.") || "Deleting this project permanently removes all of its conversations and messages.")}
              {projectPendingDeletion ? ` ${projectSessionCount} ${translate("conversation(s) will be removed.") || "conversation(s) will be removed."}` : ""}
            </p>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0">
            <Button variant="outline" type="button" onClick={() => setProjectPendingDeletion(null)}>{translate("Cancel") || "Cancel"}</Button>
            <Button variant="destructive" type="button" onClick={() => {
              if (projectPendingDeletion) handleDeleteProject(projectPendingDeletion.id);
              setProjectPendingDeletion(null);
            }}>{translate("Delete project") || "Delete project"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">{translate("History") || "History"}</h2>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Export") || "Export"} onClick={() => onExport("markdown")} className="size-7">
            <Download className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("New chat") || "New chat"} onClick={handleNewChat} disabled={!activeModel} className="size-7">
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder={translate("Search...") || "Search..."}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {selectedSessionCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <button type="button" onClick={toggleAllVisibleSessions} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Checkbox checked={allVisibleSessionsSelected} className="pointer-events-none" />
            {`${selectedSessionCount} ${translate("selected") || "selected"}`}
          </button>
          <Button variant="ghost" size="icon-sm" type="button" onClick={handleBulkDeleteSessions} className="size-6 text-destructive hover:text-destructive">
            <Trash2 className="size-3" />
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar">
        {groupedSessionItems.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {historySearch ? (translate("No results") || "No results") : (translate("No conversations yet.") || "No conversations yet.")}
          </p>
        ) : (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={filteredSessionItems.map((session) => session.id)} strategy={verticalListSortingStrategy}>
              {groupedSessionItems.map((group) => (
                <div key={group.label}>
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                  {group.items.map((session) => (
                    <SortableSessionItem
                      key={session.id}
                      session={session}
                      isActive={session.id === activeSessionId}
                      isSelected={selectedSessionIds.has(session.id)}
                      isRenaming={renamingSessionId === session.id}
                      renameValue={renameValue}
                      selectedCount={selectedSessionCount}
                      onSelect={handleSelectSession}
                      onToggleSelect={toggleSessionSelected}
                      onStartRename={startRenameSession}
                      onCommitRename={(id) => { if (id) commitRenameSession(id); else setRenamingSessionId(""); }}
                      onDelete={handleDeleteSession}
                      onRenameChange={setRenameValue}
                      renameInputRef={renameInputRef}
                    />
                  ))}
                </div>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  );
}
