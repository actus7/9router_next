"use client";

import { useState } from "react";
import { ShieldCheck, UserMinus, Users } from "lucide-react";

import Card from "@/shared/components/Card";
import { ConfirmModal } from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import AccessPolicyDialog from "@/shared/components/access/AccessPolicyDialog";
import { isRestricted, summarizeAccess } from "@/shared/components/access/accessSummary";
import { saveAccessPolicy, type WorkspaceInfo } from "@/shared/hooks/useWorkspace";
import type { AccessPolicy } from "@/shared/access/accessPolicy";
import type { TeamMember } from "../hooks/useTeam";
import RoleBadge from "./RoleBadge";

const t = (text: string): string => translate(text) || text;

export const MEMBER_FIELDS = ["models", "plugins", "skills"] as const;

interface Props {
  members: TeamMember[];
  workspace: WorkspaceInfo;
  canManage: boolean;
  policyFor: (subjectId: string) => AccessPolicy;
  /** The workspace-wide limit narrows everyone; "Full access" would then be untrue. */
  teamRestricted: boolean;
  onPoliciesChanged: () => Promise<unknown>;
  onChangeRole: (memberId: string, role: "admin" | "member") => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

export default function MembersCard({ members, workspace, canManage, policyFor, teamRestricted, onPoliciesChanged, onChangeRole, onRemove }: Props) {
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = workspace.me.userId;
  const viewerIsOwner = workspace.me.role === "owner";

  const act = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Card title={t("Members")} subtitle={`${members.length} ${members.length === 1 ? t("person") : t("people")}`} icon={<Users className="size-5" />}>
      <ul className="flex flex-col divide-y divide-border">
        {members.map((member) => {
          const isMe = member.userId === me;
          // An owner is only managed by another owner; nobody manages themselves here.
          const manageable = canManage && !isMe && (member.role !== "owner") && (member.role !== "admin" || viewerIsOwner);
          const policy = policyFor(member.userId);
          const limited = member.role === "member" && isRestricted(policy, MEMBER_FIELDS);
          return (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-main" aria-hidden>
                {initials(member.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-text-main">
                  {member.name}
                  {isMe && <span className="text-xs font-normal text-text-muted">({t("you")})</span>}
                </p>
                <p className="truncate text-xs text-text-muted">{member.email}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {manageable ? (
                  <select
                    value={member.role}
                    onChange={(event) => void act(() => onChangeRole(member.id, event.target.value as "admin" | "member"))}
                    className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-xs text-text-main"
                    aria-label={`${t("Role of")} ${member.name}`}
                  >
                    <option value="member">{t("Member")}</option>
                    <option value="admin">{t("Admin")}</option>
                  </select>
                ) : (
                  <RoleBadge role={member.role} />
                )}
                {member.role === "member" && (canManage || isMe) && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<ShieldCheck className={cn("size-4", limited && "text-primary")} />}
                    onClick={() => setEditing(member)}
                    title={summarizeAccess(policy, MEMBER_FIELDS)}
                  >
                    <span className="hidden sm:inline">{limited ? summarizeAccess(policy, MEMBER_FIELDS) : teamRestricted ? t("No extra limits") : t("Full access")}</span>
                  </Button>
                )}
                {manageable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRemoving(member)}
                    className="text-text-muted hover:text-destructive"
                    aria-label={`${t("Remove")} ${member.name}`}
                    title={t("Remove from the team")}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      {editing && (
        <AccessPolicyDialog
          isOpen
          title={`${t("Access")} · ${editing.name}`}
          description={
            canManage
              ? t("What this person can use in the chat and through their API keys. Leave a section on All to keep it unrestricted.")
              : t("What you can use in the chat and through your API keys. Only an owner or admin can change it.")
          }
          fields={MEMBER_FIELDS}
          initial={policyFor(editing.userId)}
          catalog={workspace.catalog}
          readOnly={!canManage}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await saveAccessPolicy("member", editing.userId, next);
            await onPoliciesChanged();
          }}
        />
      )}
      <ConfirmModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const member = removing!;
          setRemoving(null);
          void act(() => onRemove(member.id));
        }}
        title={t("Remove from the team")}
        message={`${removing?.name ?? ""}: ${t("loses access to this team right away, and their API keys stop working. Their chats stay with the team, readable by nobody.")}`}
        confirmText={t("Remove")}
        variant="danger"
      />
    </Card>
  );
}
