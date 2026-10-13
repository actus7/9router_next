"use client";

import { useState } from "react";
import { Check, Copy, MailPlus, X } from "lucide-react";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translate } from "@/i18n/runtime";
import type { SentInvitation } from "../hooks/useTeam";

const t = (text: string): string => translate(text) || text;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  invitations: SentInvitation[];
  onInvite: (email: string, role: "admin" | "member") => Promise<string>;
  onCancel: (invitationId: string) => Promise<void>;
}

/**
 * Invitations go out without an email (no mail provider is configured), so
 * the card says what actually happens: the person signs in with that address
 * and finds the invitation waiting on this page. The link to share is the one
 * place that is always true.
 */
export default function InviteCard({ invitations, onInvite, onCancel }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const teamLink = typeof window === "undefined" ? "/dashboard/team" : `${window.location.origin}/dashboard/team`;

  const submit = async () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) {
      setError(t("Enter a valid email address."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onInvite(address, role);
      setSentTo(address);
      setEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(teamLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card title={t("Invite people")} subtitle={t("They join with the role you choose; you can change it later.")} icon={<MailPlus className="size-5" />}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("name@company.com")}
          aria-label={t("Email to invite")}
          className="sm:flex-1"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as "admin" | "member")}
          className="h-9 cursor-pointer rounded-md border border-border bg-surface px-2 text-sm text-text-main"
          aria-label={t("Role")}
        >
          <option value="member">{t("Member")}</option>
          <option value="admin">{t("Admin")}</option>
        </select>
        <Button type="submit" disabled={busy || !email.trim()}>{busy ? t("Inviting...") : t("Invite")}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}

      {sentTo && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 text-text-main">
            {t("Invitation created for")} <strong>{sentTo}</strong>. {t("Send them this link; the invitation shows up after they sign in with that email.")}
          </span>
          <Button variant="outline" size="sm" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copyLink()}>
            {copied ? t("Copied") : t("Copy link")}
          </Button>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">{t("Waiting to accept")}</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {invitations.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-text-main">{invite.email}</span>
                <span className="text-xs text-text-muted">{t(invite.role === "admin" ? "Admin" : "Member")}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void onCancel(invite.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}
                  aria-label={`${t("Cancel invitation for")} ${invite.email}`}
                  title={t("Cancel invitation")}
                  className="text-text-muted hover:text-destructive"
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
