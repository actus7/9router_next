"use client";

import { useCallback } from "react";
import useSWR from "swr";

import { authClient } from "@/lib/auth/client";
import { switchWorkspace, type WorkspaceRole } from "@/shared/hooks/useWorkspace";

export interface TeamMember {
  id: string;
  userId: string;
  role: WorkspaceRole;
  name: string;
  email: string;
}

export interface SentInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

export interface ReceivedInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
}

interface TeamData {
  name: string;
  members: TeamMember[];
  invitations: SentInvitation[];
}

function roleOf(raw: unknown): WorkspaceRole {
  const roles = String(raw ?? "").split(",").map((role) => role.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

async function unwrap<T>(promise: Promise<{ data: T | null; error: { message?: string } | null }>, fallback: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || fallback);
  return data as T;
}

/**
 * The organization the session is in — members, invitations sent — plus the
 * invitations this user has received, and every action the team page takes.
 * All of it goes through Neon Auth's organization API, which enforces who may
 * do what (only owners and admins invite, only owners change an owner).
 */
export function useTeam(organizationId: string | null) {
  const team = useSWR<TeamData | null>(organizationId ? ["team", organizationId] : null, async () => {
    const data = await unwrap(
      authClient.organization.getFullOrganization({ query: { organizationId: organizationId! } }),
      "Could not load the team",
    ) as Record<string, unknown> | null;
    if (!data) return null;
    const members = ((data.members as Array<Record<string, unknown>>) ?? []).map((member) => {
      const user = (member.user ?? {}) as Record<string, unknown>;
      return {
        id: String(member.id),
        userId: String(member.userId),
        role: roleOf(member.role),
        name: String(user.name || user.email || member.userId),
        email: String(user.email || ""),
      };
    });
    const invitations = ((data.invitations as Array<Record<string, unknown>>) ?? [])
      .filter((invite) => invite.status === "pending")
      .map((invite) => ({
        id: String(invite.id),
        email: String(invite.email),
        role: String(invite.role || "member"),
        status: String(invite.status),
        expiresAt: String(invite.expiresAt),
      }));
    return { name: String(data.name || ""), members, invitations };
  }, { revalidateOnFocus: false });

  // Neon Auth only shows invitations to an account that proved it owns the
  // address — otherwise anyone signing up with a colleague's email would get
  // their invitations. That answer is a state to explain, not an error.
  const received = useSWR<ReceivedInvitation[] | "verify-email">("auth:received-invitations", async () => {
    const needsVerification = (failure: unknown): boolean => {
      const info = (failure ?? {}) as { code?: unknown; message?: unknown; error?: { code?: unknown } };
      const code = String(info.code ?? info.error?.code ?? "");
      return code === "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION" || /email verification required/i.test(String(info.message ?? ""));
    };
    let result: Awaited<ReturnType<typeof authClient.organization.listUserInvitations>>;
    try {
      result = await authClient.organization.listUserInvitations();
    } catch (thrown) {
      if (needsVerification(thrown)) return "verify-email";
      throw thrown;
    }
    const { data, error } = result;
    if (error) {
      if (needsVerification(error)) return "verify-email";
      throw new Error(error.message || "Could not load invitations");
    }
    return ((data ?? []) as Array<Record<string, unknown>>)
      .filter((invite) => invite.status === "pending")
      .map((invite) => ({
        id: String(invite.id),
        organizationId: String(invite.organizationId),
        organizationName: String(invite.organizationName || invite.organizationId),
        role: String(invite.role || "member"),
      }));
  }, { revalidateOnFocus: false });

  const refresh = useCallback(async () => {
    await Promise.all([team.mutate(), received.mutate()]);
  }, [team, received]);

  return {
    team: team.data ?? null,
    loading: team.isLoading,
    error: team.error as Error | undefined,
    received: Array.isArray(received.data) ? received.data : [],
    /** The account must confirm its email before it can see or accept invitations. */
    needsEmailVerification: received.data === "verify-email",
    reloadInvitations: () => received.mutate(),
    refresh,
    async invite(email: string, role: "admin" | "member"): Promise<string> {
      const data = await unwrap(
        authClient.organization.inviteMember({ email, role, organizationId: organizationId! }),
        "Could not send the invitation",
      ) as { id?: string } | null;
      await team.mutate();
      return String(data?.id ?? "");
    },
    async cancelInvitation(invitationId: string) {
      await unwrap(authClient.organization.cancelInvitation({ invitationId }), "Could not cancel the invitation");
      await team.mutate();
    },
    async changeRole(memberId: string, role: "admin" | "member") {
      await unwrap(
        authClient.organization.updateMemberRole({ memberId, role, organizationId: organizationId! }),
        "Could not change the role",
      );
      await team.mutate();
    },
    async removeMember(memberIdOrEmail: string) {
      await unwrap(
        authClient.organization.removeMember({ memberIdOrEmail, organizationId: organizationId! }),
        "Could not remove the member",
      );
      await team.mutate();
    },
    async accept(invitation: ReceivedInvitation) {
      await unwrap(authClient.organization.acceptInvitation({ invitationId: invitation.id }), "Could not accept the invitation");
      await switchWorkspace(invitation.organizationId);
    },
    async decline(invitationId: string) {
      await unwrap(authClient.organization.rejectInvitation({ invitationId }), "Could not decline the invitation");
      await received.mutate();
    },
    async leave() {
      await unwrap(authClient.organization.leave({ organizationId: organizationId! }), "Could not leave the team");
      await switchWorkspace(null);
    },
  };
}

/** Turns the personal workspace into a team (keeping its data) and switches into it. */
export async function convertToTeam(name: string): Promise<void> {
  const response = await fetch("/api/team/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await response.json().catch(() => ({}))) as { organizationId?: string; error?: string };
  if (!response.ok || !body.organizationId) throw new Error(body.error || `Request failed (${response.status})`);
  await switchWorkspace(body.organizationId);
}
