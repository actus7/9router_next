"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { translate } from "@/i18n/runtime";
import {
  Archive, ArchiveRestore, CheckCircle2, Download, FolderKanban, Pencil, Plus, Search, Trash2, X,
} from "lucide-react";
import { formatRelativeTime } from "../chatFormatUtils";
import type { ChatProject, ChatSession } from "../types";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import IconActionButton from "./IconActionButton";

interface SessionItemProps {
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
  onToggleArchive: (id: string) => void;
  onCancelRename: () => void;
  onRenameChange: (value: string) => void;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
}

function SessionItem({
  session, isActive, isSelected, isRenaming, renameValue, selectedCount,
  onSelect, onToggleSelect, onStartRename, onCommitRename, onCancelRename, onDelete, onToggleArchive, onRenameChange, renameInputRef,
}: SessionItemProps) {
  return (
    <div
      className={`group relative flex w-full items-center gap-1.5 rounded-lg py-2 pl-3 pr-2 text-left text-sm transition-colors hover:bg-muted ${isActive ? "bg-primary/10" : ""}`}
    >
      <span className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
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
          <input
            ref={renameInputRef}
            value={renameValue}
            aria-label={translate("Rename") || "Rename"}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommitRename(session.id); }
              // Escape abandons the edit. The blur it triggers must not sneak
              // the discarded value back in, so cancel before the field blurs.
              if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
            }}
            onBlur={() => onCommitRename(session.id)}
            className="h-5 w-full rounded border border-border bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <button type="button" onClick={() => onSelect(session.id)} className="block w-full min-w-0 text-left">
            <span className="block truncate text-xs font-medium text-card-foreground">{session.title}</span>
            <span className="block text-[10px] text-muted-foreground">{formatRelativeTime(session.updatedAt)}</span>
          </button>
        )}
      </div>
      {!isRenaming && (
        <div className="flex shrink-0 gap-0.5 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <IconActionButton tooltip={translate("Rename") || "Rename"} onClick={(e: React.MouseEvent) => onStartRename(e, session)} className="size-5"><Pencil className="size-2.5" /></IconActionButton>
          <IconActionButton
            tooltip={session.isArchived ? (translate("Unarchive") || "Unarchive") : (translate("Archive") || "Archive")}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggleArchive(session.id); }}
            className="size-5"
          >
            {session.isArchived ? <ArchiveRestore className="size-2.5" /> : <Archive className="size-2.5" />}
          </IconActionButton>
          <IconActionButton tooltip={translate("Delete") || "Delete"} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(session.id); }} className="size-5 text-destructive hover:text-destructive"><Trash2 className="size-2.5" /></IconActionButton>
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
    handleDeleteProject,
    historySearch, setHistorySearch, showArchived, setShowArchived, selectedSessionCount, allVisibleSessionsSelected,
    toggleAllVisibleSessions, handleBulkDeleteSessions, groupedSessionItems,
    activeSessionId, selectedSessionIds, renamingSessionId, setRenamingSessionId, renameValue,
    handleSelectSession, toggleSessionSelected, startRenameSession, commitRenameSession, handleDeleteSession,
    handleToggleArchiveSession, setRenameValue, renameInputRef,
  } = sessionsHook;
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<ChatProject | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [sessionPendingDeletion, setSessionPendingDeletion] = useState<ChatSession | null>(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  const startRenameProject = (event: React.MouseEvent, project: ChatProject) => {
    event.stopPropagation();
    setRenamingProjectId(project.id);
    setProjectTitle(project.title);
  };
  const commitRenameProject = (projectId: string) => {
    handleRenameProject(projectId, projectTitle);
    setRenamingProjectId("");
  };
  const cancelRenameProject = () => {
    setProjectTitle("");
    setRenamingProjectId("");
  };
  const projectSessionCount = projectPendingDeletion
    ? projectSessionCounts.get(projectPendingDeletion.id) || 0
    : 0;

  return (
    <aside className={`order-2 w-72 shrink-0 flex-col border-l border-border bg-card/50 min-h-0 xl:w-80 ${sidebarOpen ? "hidden md:flex" : "hidden"}`}>
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{translate("Projects") || "Projects"}</h2>
          <IconActionButton
            tooltip={isCreatingProject ? (translate("Cancel") || "Cancel") : (translate("Create project") || "Create project")}
            onClick={() => setIsCreatingProject((value) => !value)}
            className="size-7"
          >
            {isCreatingProject ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          </IconActionButton>
        </div>
        {isCreatingProject ? (
          <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); handleCreateProject(); }}>
            <Input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={80} placeholder={translate("Project name") || "Project name"} className="h-8 min-w-0 text-xs" />
            <Button type="submit" size="sm" className="h-8 px-2 text-xs" disabled={!newProjectName.trim()}>{translate("Add") || "Add"}</Button>
          </form>
        ) : null}
        <div className="mt-1 flex flex-col gap-0.5" role="list" aria-label={translate("Projects") || "Projects"}>
          <button type="button" onClick={() => handleSelectProject("")} aria-pressed={!activeProjectId} className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${!activeProjectId ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <FolderKanban className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{translate("All conversations") || "All conversations"}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{sessions.filter((session) => !session.isArchived).length}</span>
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
                        if (event.key === "Enter") { event.preventDefault(); commitRenameProject(project.id); }
                        if (event.key === "Escape") { event.preventDefault(); cancelRenameProject(); }
                      }}
                      onBlur={() => { if (renamingProjectId === project.id) commitRenameProject(project.id); }}
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
                      <IconActionButton tooltip={translate("Rename project") || "Rename project"} onClick={(event) => startRenameProject(event, project)} className="size-5">
                        <Pencil className="size-2.5" />
                      </IconActionButton>
                      <IconActionButton tooltip={translate("Delete project") || "Delete project"} onClick={(event) => { event.stopPropagation(); setProjectPendingDeletion(project); }} className="size-5 text-destructive hover:text-destructive">
                        <Trash2 className="size-2.5" />
                      </IconActionButton>
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
      <Dialog open={Boolean(sessionPendingDeletion)} onOpenChange={(open) => { if (!open) setSessionPendingDeletion(null); }}>
        <DialogContent showCloseButton={false} className="gap-4 p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>{translate("Delete conversation?") || "Delete conversation?"}</DialogTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              {translate("This permanently removes the conversation and all of its messages.") || "This permanently removes the conversation and all of its messages."}
            </p>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0">
            <Button variant="outline" type="button" onClick={() => setSessionPendingDeletion(null)}>{translate("Cancel") || "Cancel"}</Button>
            <Button variant="destructive" type="button" onClick={() => {
              if (sessionPendingDeletion) handleDeleteSession(sessionPendingDeletion.id);
              setSessionPendingDeletion(null);
            }}>{translate("Delete") || "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkDeletePending} onOpenChange={(open) => { if (!open) setBulkDeletePending(false); }}>
        <DialogContent showCloseButton={false} className="gap-4 p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>{translate("Delete selected conversations?") || "Delete selected conversations?"}</DialogTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              {`${selectedSessionCount} ${translate("conversation(s) will be removed.") || "conversation(s) will be removed."}`}
            </p>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0">
            <Button variant="outline" type="button" onClick={() => setBulkDeletePending(false)}>{translate("Cancel") || "Cancel"}</Button>
            <Button variant="destructive" type="button" onClick={() => { handleBulkDeleteSessions(); setBulkDeletePending(false); }}>{translate("Delete") || "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{showArchived ? (translate("Archived") || "Archived") : (translate("History") || "History")}</h2>
        <div className="flex items-center gap-0.5">
          <IconActionButton tooltip={showArchived ? (translate("Back to history") || "Back to history") : (translate("Archived chats") || "Archived chats")} onClick={() => setShowArchived((value) => !value)} aria-pressed={showArchived} className="size-7">
            {showArchived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </IconActionButton>
          <IconActionButton tooltip={translate("Export") || "Export"} onClick={() => onExport("markdown")} className="size-7">
            <Download className="size-3.5" />
          </IconActionButton>
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2">
        {isSearchOpen ? (
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={translate("Search...") || "Search..."}
                className="h-7 pl-7 text-xs"
              />
            </div>
            <IconActionButton
              tooltip={translate("Close search") || "Close search"}
              onClick={() => { setIsSearchOpen(false); setHistorySearch(""); }}
              className="size-7"
            >
              <X className="size-3.5" />
            </IconActionButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Search className="size-3.5" />
            {translate("Search") || "Search"}
          </button>
        )}
      </div>

      {selectedSessionCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <button type="button" onClick={toggleAllVisibleSessions} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Checkbox checked={allVisibleSessionsSelected} className="pointer-events-none" />
            {`${selectedSessionCount} ${translate("selected") || "selected"}`}
          </button>
          <IconActionButton tooltip={translate("Delete selected") || "Delete selected"} onClick={() => setBulkDeletePending(true)} className="size-6 text-destructive hover:text-destructive">
            <Trash2 className="size-3" />
          </IconActionButton>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar">
        {groupedSessionItems.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {historySearch
              ? (translate("No results") || "No results")
              : showArchived
                ? (translate("No archived conversations.") || "No archived conversations.")
                : (translate("No conversations yet.") || "No conversations yet.")}
          </p>
        ) : (
          groupedSessionItems.map((group) => (
            <div key={group.label}>
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              {group.items.map((session) => (
                <SessionItem
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
                  onCommitRename={commitRenameSession}
                  onCancelRename={() => setRenamingSessionId("")}
                  onDelete={(id) => setSessionPendingDeletion(group.items.find((item) => item.id === id) || null)}
                  onToggleArchive={handleToggleArchiveSession}
                  onRenameChange={setRenameValue}
                  renameInputRef={renameInputRef}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}


