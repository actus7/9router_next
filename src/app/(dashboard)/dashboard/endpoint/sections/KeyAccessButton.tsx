"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import AccessPolicyDialog from "@/shared/components/access/AccessPolicyDialog";
import { isRestricted, summarizeAccess } from "@/shared/components/access/accessSummary";
import { saveAccessPolicy, useWorkspace } from "@/shared/hooks/useWorkspace";
import type { ApiKey } from "../types";

const t = (text: string): string => translate(text) || text;

/** What a key may ask for. Members, who cannot change it, see it read-only. */
const KEY_FIELDS = ["models", "skills"] as const;

export default function KeyAccessButton({ apiKey }: { apiKey: ApiKey }) {
  const { workspace, canManage, policyFor, reload } = useWorkspace();
  const [open, setOpen] = useState(false);
  const policy = policyFor("key", apiKey.id);
  const restricted = isRestricted(policy, KEY_FIELDS);
  const summary = summarizeAccess(policy, KEY_FIELDS);
  const keyLabel = apiKey.name || apiKey.id;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        icon={<ShieldCheck className={cn("size-4", restricted && "text-primary")} />}
        onClick={() => setOpen(true)}
        disabled={!workspace}
        title={summary}
        aria-label={`${t("Access")} · ${keyLabel}: ${summary}`}
      >
        <span className="hidden sm:inline">{t("Access")}</span>
      </Button>
      {open && workspace && (
        <AccessPolicyDialog
          isOpen
          title={`${t("Access")} · ${keyLabel}`}
          description={
            canManage
              ? t("What this key may request. Leave a section on All to keep it unrestricted; the team's own limits still apply on top.")
              : t("What this key may request. Only an owner or admin can change it.")
          }
          fields={KEY_FIELDS}
          initial={policy}
          catalog={workspace.catalog}
          readOnly={!canManage}
          onClose={() => setOpen(false)}
          onSave={async (next) => {
            await saveAccessPolicy("key", apiKey.id, next);
            await reload();
          }}
        />
      )}
    </>
  );
}
