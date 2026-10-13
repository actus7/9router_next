"use client";

import { useState } from "react";
import { LogOut, Users } from "lucide-react";

import { ConfirmModal } from "@/shared/components/Modal";
import { Spinner } from "@/shared/components/Loading";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { useOrganizations, useWorkspace } from "@/shared/hooks/useWorkspace";
import { useTeam } from "./hooks/useTeam";
import PersonalWorkspaceCard from "./sections/PersonalWorkspaceCard";
import ReceivedInvitesCard from "./sections/ReceivedInvitesCard";
import VerifyEmailCard from "./sections/VerifyEmailCard";
import MembersCard, { MEMBER_FIELDS } from "./sections/MembersCard";
import { isRestricted } from "@/shared/components/access/accessSummary";
import InviteCard from "./sections/InviteCard";
import TeamAccessCard from "./sections/TeamAccessCard";
import RoleBadge, { ROLE_HINT } from "./sections/RoleBadge";

const t = (text: string): string => translate(text) || text;

/**
 * Thin orchestrator: who the user is in the current workspace decides which
 * sections show. A personal workspace offers to become a team; a team shows
 * its members, invitations and limits, with management controls only for
 * owners and admins (the API enforces the same split).
 */
export default function TeamClient() {
  const { workspace, error: workspaceError, canManage, policyFor, reload } = useWorkspace();
  const organizations = useOrganizations();
  // A personal workspace turned into a team keeps the user's id, so "is this a
  // team" is whether an organization with the tenant's id exists.
  const isTeam = Boolean(workspace && organizations.data?.some((org) => org.id === workspace.me.tenantId));
  const team = useTeam(isTeam ? workspace!.me.tenantId : null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  if (workspaceError || team.error) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {(workspaceError ?? team.error)?.message || t("Could not load the team.")}
      </p>
    );
  }
  if (!workspace || organizations.isLoading || (isTeam && team.loading)) {
    return <div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {team.received.length > 0 && (
        <ReceivedInvitesCard invitations={team.received} onAccept={team.accept} onDecline={team.decline} />
      )}

      {!isTeam ? (
        <PersonalWorkspaceCard />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
                <Users className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-text-main">{team.team?.name || t("Team")}</h1>
                <p className="text-sm text-text-muted">{t(ROLE_HINT[workspace.me.role])}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <RoleBadge role={workspace.me.role} />
              {workspace.me.role !== "owner" && (
                <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => setLeaving(true)}>
                  {t("Leave team")}
                </Button>
              )}
            </div>
            {leaveError && <p role="alert" className="w-full text-sm text-destructive">{leaveError}</p>}
          </header>

          <MembersCard
            members={team.team?.members ?? []}
            workspace={workspace}
            canManage={canManage}
            policyFor={(subjectId) => policyFor("member", subjectId)}
            teamRestricted={isRestricted(policyFor("org", workspace.me.tenantId), MEMBER_FIELDS)}
            onPoliciesChanged={reload}
            onChangeRole={team.changeRole}
            onRemove={team.removeMember}
          />

          {canManage && (
            <InviteCard invitations={team.team?.invitations ?? []} onInvite={team.invite} onCancel={team.cancelInvitation} />
          )}
        </>
      )}

      {(canManage || isTeam) && (
        <TeamAccessCard workspace={workspace} canManage={canManage} policy={policyFor("org", workspace.me.tenantId)} onChanged={reload} />
      )}

      {team.needsEmailVerification && workspace.me.email && (
        <VerifyEmailCard email={workspace.me.email} onVerified={team.reloadInvitations} />
      )}

      <ConfirmModal
        isOpen={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          void team.leave().catch((cause: unknown) => setLeaveError(cause instanceof Error ? cause.message : String(cause)));
        }}
        title={t("Leave team")}
        message={t("You lose access to this team and your API keys in it stop working. An admin can invite you again.")}
        confirmText={t("Leave team")}
        variant="danger"
      />
    </div>
  );
}
