"use client";

import { Brain } from "lucide-react";
import Card from "@/shared/components/Card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import type { LearnedCapability, useLearnedAnswers } from "../hooks/useLearnedAnswers";

const t = (text: string) => translate(text) || text;

const STATUS: Record<LearnedCapability["status"], { label: string; variant: "info" | "success" | "outline" }> = {
  shadow: { label: "Validating", variant: "info" },
  active: { label: "Active", variant: "success" },
  deprecated: { label: "Retired", variant: "outline" },
};

type Learning = ReturnType<typeof useLearnedAnswers>;

/**
 * Synapse Loop answers this account learned. Learning is switched on per API
 * key and per conversation (their abilities); the answers are the account's,
 * shared by every key and chat, so they are reviewed here.
 */
export default function LearnedAnswersCard({ learning }: { learning: Learning }) {
  const { capabilities } = learning;
  return (
    <Card id="learned-answers">
      <section className="flex flex-col gap-3" aria-labelledby="learned-answers-title">
        <div>
          <h2 id="learned-answers-title" className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="size-4" />
            {t("Learned answers")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("Questions this account repeats, whose answer depends on nothing else, become local answers — after proving themselves against the model. Turn learning on in a key's or a chat's abilities.")}
          </p>
        </div>

        {capabilities.length > 0 ? (
          <>
            <ul className="flex flex-col divide-y divide-border/60" aria-label={t("Learned answers")}>
              {capabilities.map((cap) => {
                const status = STATUS[cap.status];
                return (
                  <li key={cap.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{cap.canonicalInput}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{cap.answer}</p>
                      <p className="text-xs text-muted-foreground">
                        {cap.status === "shadow"
                          ? `${t("Agreed")} ${cap.shadowAgreements}/${cap.shadowRuns}`
                          : `${t("Served")} ${cap.served}`}
                        {cap.rejections > 0 ? ` · ${t("Rejected")} ${cap.rejections}` : ""}
                        {cap.source === "jev" ? " · Jev" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={status.variant}>{t(status.label)}</Badge>
                      {cap.status === "deprecated" ? (
                        <Button size="sm" variant="outline" onClick={() => learning.reactivate(cap.id)}>{t("Reactivate")}</Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => learning.retire(cap.id)}>{t("Retire")}</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => learning.remove(cap.id)}>{t("Delete")}</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                if (window.confirm(t("Forget everything Synapse learned for this account?"))) learning.forgetAll();
              }}
            >
              {t("Forget everything Synapse learned")}
            </Button>
          </>
        ) : null}
        {!learning.loading && capabilities.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("Nothing learned yet. A question needs two equivalent answers to start being validated.")}
          </p>
        ) : null}
      </section>
    </Card>
  );
}
