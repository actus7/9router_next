"use client";

import { useState } from "react";
import { Users } from "lucide-react";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translate } from "@/i18n/runtime";
import { convertToTeam } from "../hooks/useTeam";

const t = (text: string): string => translate(text) || text;

/**
 * The personal workspace, and the one step that turns it into a team. The copy
 * says plainly what moves along — everything — because "create a team" in most
 * products means starting empty, and here it does not.
 */
export default function PersonalWorkspaceCard() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await convertToTeam(name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Card title={t("Personal workspace")} subtitle={t("Only you can see and use what is here.")} icon={<Users className="size-5" />}>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium text-text-main">{t("Work with a team")}</p>
          <p className="mt-1 text-sm text-text-muted">
            {t("Turn this workspace into a team to invite people. Your providers, combos, API keys and history come along; each person keeps their own chats, and you decide which models, tools and skills each one can use.")}
          </p>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void submit();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Team name, e.g. Acme Engineering")}
            aria-label={t("Team name")}
            maxLength={80}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? t("Creating team...") : t("Turn into a team")}
          </Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Card>
  );
}
