"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import AccessPolicyDialog from "@/shared/components/access/AccessPolicyDialog";
import { summarizeAccess } from "@/shared/components/access/accessSummary";
import { saveAccessPolicy, type WorkspaceInfo } from "@/shared/hooks/useWorkspace";
import type { AccessPolicy } from "@/shared/access/accessPolicy";
import { MEMBER_FIELDS } from "./MembersCard";

const t = (text: string): string => translate(text) || text;

interface Props {
  workspace: WorkspaceInfo;
  canManage: boolean;
  policy: AccessPolicy;
  onChanged: () => Promise<unknown>;
}

/**
 * The limit that applies to everyone and every key in the workspace, owners
 * included — the outermost layer. Per-person and per-key limits can only
 * narrow it.
 */
export default function TeamAccessCard({ workspace, canManage, policy, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const summary = summarizeAccess(policy, MEMBER_FIELDS);

  return (
    <Card
      title={t("Limits for everyone")}
      subtitle={t("Applies to every person and every API key in this workspace. Per-person and per-key limits can only narrow it.")}
      icon={<ShieldCheck className="size-5" />}
      action={
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {canManage ? t("Edit") : t("View")}
        </Button>
      }
    >
      <p className="text-sm text-text-main">{summary}</p>
      {open && (
        <AccessPolicyDialog
          isOpen
          title={t("Limits for everyone")}
          description={t("Models, chat tools and skills anyone in this workspace can use, through the chat or any API key.")}
          fields={MEMBER_FIELDS}
          initial={policy}
          catalog={workspace.catalog}
          readOnly={!canManage}
          onClose={() => setOpen(false)}
          onSave={async (next) => {
            await saveAccessPolicy("org", workspace.me.tenantId, next);
            await onChanged();
          }}
        />
      )}
    </Card>
  );
}
