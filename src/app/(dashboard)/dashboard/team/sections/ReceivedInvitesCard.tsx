"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import type { ReceivedInvitation } from "../hooks/useTeam";

const t = (text: string): string => translate(text) || text;

interface Props {
  invitations: ReceivedInvitation[];
  onAccept: (invitation: ReceivedInvitation) => Promise<void>;
  onDecline: (invitationId: string) => Promise<void>;
}

/** Invitations addressed to this account. Accepting switches straight into the team. */
export default function ReceivedInvitesCard({ invitations, onAccept, onDecline }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  return (
    <Card title={t("Invitations for you")} icon={<Inbox className="size-5" />} className="border-primary/40">
      <ul className="flex flex-col gap-2">
        {invitations.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-primary/5 px-3 py-2.5">
            <span className="min-w-0 flex-1 text-sm text-text-main">
              <strong>{invite.organizationName}</strong> {t("invited you as")} {t(invite.role === "admin" ? "Admin" : "Member")}
            </span>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run(invite.id, () => onDecline(invite.id))}>
              {t("Decline")}
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => void run(invite.id, () => onAccept(invite))}>
              {busy === invite.id ? t("Joining...") : t("Join team")}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </Card>
  );
}
