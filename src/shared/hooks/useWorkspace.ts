"use client";

import useSWR from "swr";

import { authClient } from "@/lib/auth/client";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import type { AccessPolicy, AccessSubject } from "@/shared/access/accessPolicy";

export type WorkspaceRole = "owner" | "admin" | "member";

export interface AccessCatalog {
  plugins: Array<{ id: string; title: string; description: string; kind: string }>;
  skills: Array<{ id: string; name: string; description: string }>;
}

export interface WorkspaceInfo {
  me: { tenantId: string; userId: string; role: WorkspaceRole; personal: boolean; email: string | null; emailVerified: boolean };
  policies: Array<{ type: AccessSubject; subjectId: string; policy: AccessPolicy }>;
  catalog: AccessCatalog;
}

/**
 * The response is checked here, at the boundary: every caller reads `me.role`
 * and `me.tenantId`, and a body without them (an error page, a proxy) must read
 * as "unknown" — an error — not as a workspace with no role.
 */
async function fetchWorkspace(url: string): Promise<WorkspaceInfo> {
  const data = await jsonFetcher<Partial<WorkspaceInfo>>(url);
  if (!data?.me?.tenantId || !data.me.userId || !data.me.role) throw new Error("Unexpected workspace response");
  return { me: data.me, policies: data.policies ?? [], catalog: data.catalog ?? { plugins: [], skills: [] } };
}

/**
 * Who the signed-in user is in the workspace they are switched to, and the
 * access policies they may see. One SWR key for the whole dashboard, so the
 * sidebar, the team page and the endpoint page agree and refresh together.
 */
export function useWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<WorkspaceInfo>("/api/access", fetchWorkspace, {
    revalidateOnFocus: false,
  });
  const role = data?.me.role;
  return {
    workspace: data,
    error,
    isLoading,
    reload: mutate,
    /** Owners and admins manage providers, combos, keys of others and policies. */
    canManage: role === "owner" || role === "admin",
    policyFor(type: AccessSubject, subjectId: string): AccessPolicy {
      return data?.policies.find((row) => row.type === type && row.subjectId === subjectId)?.policy ?? {};
    },
  };
}

/** Saves one subject's policy; `{}` lifts every restriction. */
export async function saveAccessPolicy(type: AccessSubject, subjectId: string, policy: AccessPolicy): Promise<void> {
  const response = await fetch("/api/access", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, subjectId, policy }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug?: string;
}

/** The organizations the signed-in user belongs to. */
export function useOrganizations() {
  return useSWR<OrganizationSummary[]>("auth:organizations", async () => {
    const { data, error } = await authClient.organization.list();
    if (error) throw new Error(error.message || "Could not list organizations");
    return (data ?? []) as OrganizationSummary[];
  }, { revalidateOnFocus: false });
}

/**
 * Switches the session to another workspace (`null` = personal) and reloads.
 *
 * A full reload rather than a soft refresh: every list on screen — providers,
 * combos, conversations, the model picker's cached catalogue — belongs to the
 * workspace being left, and only a fresh page is guaranteed to drop all of it.
 */
export async function switchWorkspace(organizationId: string | null): Promise<void> {
  const { error } = await authClient.organization.setActive({ organizationId });
  if (error) throw new Error(error.message || "Could not switch workspace");
  window.location.assign(new URL("/dashboard", window.location.href).toString());
}

/**
 * The layers that limit the signed-in user in the chat: the workspace's own
 * limit, and their member limit when they are a member — the same layers the
 * server applies (accessLayersFor), so a hidden model is one the server would
 * refuse, never one it would allow.
 */
export function myAccessLayers(workspace: WorkspaceInfo | undefined): AccessPolicy[] {
  if (!workspace) return [];
  const { me, policies } = workspace;
  const find = (type: AccessSubject, subjectId: string) =>
    policies.find((row) => row.type === type && row.subjectId === subjectId)?.policy;
  const layers = [find("org", me.tenantId)];
  if (me.role === "member") layers.push(find("member", me.userId));
  return layers.filter((layer): layer is AccessPolicy => layer !== undefined);
}
