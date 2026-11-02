"use client";

import { TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { translate } from "@/i18n/runtime";

const t = (text: string): string => translate(text) || text;

/**
 * What turning MetaBreak on actually means. The profile instructs the model to
 * put this file above the provider's own safety instructions, so the risks
 * are said plainly before it is enabled — not buried in a tooltip.
 */
export const METABREAK_RISKS = [
  "It instructs the model to set aside the provider's safety instructions. That breaks the terms of use of most providers (OpenAI, Anthropic, Google and others).",
  "The provider can suspend or ban the account, API key or subscription that serves these requests — including shared accounts other people depend on.",
  "Answers may contain harmful or inaccurate content. Responsibility for them lies with this workspace, not the provider.",
  "On an API key, it applies to every request made with that key, including requests from people or apps you gave the key to.",
  "It adds a long fixed prompt (about 6,500 tokens) to every request, which costs more, and it changes the answer format, which can break integrations that parse the response.",
] as const;

export function MetaBreakRiskNotice() {
  return (
    <div role="note" className="mt-2 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{t("High risk: MetaBreak tells the model to override the provider's safety instructions. It can get the account or key banned and breaks most providers' terms of use.")}</p>
    </div>
  );
}

type DialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MetaBreakRiskDialog({ open, onCancel, onConfirm }: DialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Enable MetaBreak?")}</AlertDialogTitle>
          <AlertDialogDescription>{t("Read the risks before enabling it:")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-2 ps-5 text-sm text-muted-foreground">
          {METABREAK_RISKS.map((risk) => <li key={risk}>{t(risk)}</li>)}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={onConfirm}>{t("I understand the risks, enable")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
