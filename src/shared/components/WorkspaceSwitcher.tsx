"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Settings2, User, Users } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { switchWorkspace, useOrganizations, useWorkspace } from "@/shared/hooks/useWorkspace";

const t = (text: string): string => translate(text) || text;

/**
 * Which workspace the dashboard is showing, and the way to change it. Shown
 * under the logo so it is always visible: everything below it — providers,
 * keys, chats — belongs to the workspace named here.
 */
export default function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace } = useWorkspace();
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations();
  const [switching, setSwitching] = useState<string | null>(null);
  // Same height as the loaded control, so the navigation below never jumps.
  // Until both are known it would have to guess the current workspace — and a
  // wrong name ("Personal" while you are in a team) is worse than a placeholder.
  if (!workspace || (organizationsLoading && !workspace.me.personal)) return <div className="h-[50px] animate-pulse rounded-lg bg-sidebar-accent/40 group-data-[collapsible=icon]:hidden" aria-hidden />;

  const userId = workspace.me.userId;
  // The personal workspace is listed on its own unless it was turned into a
  // team, in which case it is that team (same id).
  const personalIsTeam = organizations.some((org) => org.id === userId);
  const entries = [
    ...(personalIsTeam ? [] : [{ id: userId, name: t("Personal"), personal: true }]),
    ...organizations.map((org) => ({ id: org.id, name: org.name, personal: false })),
  ];
  const current = entries.find((entry) => entry.id === workspace.me.tenantId)
    ?? { id: workspace.me.tenantId, name: t("Team"), personal: false };

  const choose = async (id: string, personal: boolean) => {
    if (id === workspace.me.tenantId) return;
    setSwitching(id);
    try {
      await switchWorkspace(personal ? null : id);
    } catch {
      setSwitching(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-data-[collapsible=icon]:hidden"
            aria-label={`${t("Workspace")}: ${current?.name ?? ""}`}
          />
        }
      >
        {current?.personal ? <User className="size-4 shrink-0 text-sidebar-foreground/70" /> : <Users className="size-4 shrink-0 text-sidebar-foreground/70" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-sidebar-foreground">{switching ? t("Switching...") : current?.name}</span>
          <span className="block truncate text-[11px] text-sidebar-foreground/60">{t(workspace.me.role === "owner" ? "Owner" : workspace.me.role === "admin" ? "Admin" : "Member")}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>{t("Workspaces")}</DropdownMenuLabel>
        {entries.map((entry) => (
          <DropdownMenuItem key={entry.id} onClick={() => void choose(entry.id, entry.personal)}>
            {entry.personal ? <User /> : <Users />}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <Check className={cn("size-4", entry.id === workspace.me.tenantId ? "opacity-100" : "opacity-0")} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/dashboard/team" onClick={onNavigate} />}>
          <Settings2 />
          <span>{personalIsTeam || !current?.personal ? t("Manage team") : t("Create a team")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
