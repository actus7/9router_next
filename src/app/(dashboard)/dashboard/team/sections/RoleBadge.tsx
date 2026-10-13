import { Crown, Shield, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { WorkspaceRole } from "@/shared/hooks/useWorkspace";

const t = (text: string): string => translate(text) || text;

const ROLE_STYLE: Record<WorkspaceRole, { label: string; icon: typeof Crown; className: string }> = {
  owner: { label: "Owner", icon: Crown, className: "bg-primary/10 text-primary" },
  admin: { label: "Admin", icon: Shield, className: "bg-accent text-text-main" },
  member: { label: "Member", icon: User, className: "bg-muted text-text-muted" },
};

export const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: "Everything, including removing admins and the team itself.",
  admin: "Providers, combos, every API key, members and access limits.",
  member: "Chat and their own API keys, within the limits an admin sets.",
};

export default function RoleBadge({ role }: { role: WorkspaceRole }) {
  const style = ROLE_STYLE[role];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", style.className)} title={t(ROLE_HINT[role])}>
      <Icon className="size-3" aria-hidden />
      {t(style.label)}
    </span>
  );
}
