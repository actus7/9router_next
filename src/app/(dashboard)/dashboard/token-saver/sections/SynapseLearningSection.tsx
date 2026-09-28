"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { LearnedCapability, useSynapseLearning } from "../hooks/useSynapseLearning";

const t = (text: string) => translate(text) || text;

const STATUS: Record<LearnedCapability["status"], { label: string; variant: "info" | "success" | "outline" }> = {
  shadow: { label: "Validating", variant: "info" },
  active: { label: "Active", variant: "success" },
  deprecated: { label: "Retired", variant: "outline" },
};

type Learning = Pick<
  ReturnType<typeof useSynapseLearning>,
  "enabled" | "saving" | "capabilities" | "loading" | "setEnabled" | "retire" | "reactivate" | "remove" | "forgetAll"
>;

/** Synapse Loop: auto-learning switch and the capabilities this account learned. */
export default function SynapseLearningSection({ learning }: { learning: Learning }) {
  const { capabilities } = learning;
  return (
    <section className="mt-3 flex flex-col gap-3 rounded-lg border border-border/60 p-3" aria-labelledby="synapse-learning-title">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label id="synapse-learning-title" htmlFor="synapse-learning" className="font-medium text-sm">
            {t("Automatic learning")}
          </label>
          <p id="synapse-learning-description" className="text-xs text-text-muted">
            {t("Questions this account repeats, whose answer depends on nothing else, become local answers — after proving themselves against the model. Chat and API. Uses Jev when the decision engine is Jev.")}
          </p>
        </div>
        <Switch
          id="synapse-learning"
          aria-label={t("Automatic learning")}
          aria-describedby="synapse-learning-description"
          checked={learning.enabled}
          disabled={learning.saving}
          onCheckedChange={(checked) => learning.setEnabled(checked)}
        />
      </div>

      {capabilities.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-border/60" aria-label={t("Learned answers")}>
            {capabilities.map((cap) => {
              const status = STATUS[cap.status];
              return (
                <li key={cap.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{cap.canonicalInput}</p>
                    <p className="text-xs text-text-muted line-clamp-2">{cap.answer}</p>
                    <p className="text-xs text-text-muted">
                      {cap.status === "shadow"
                        ? `${t("Agreed")} ${cap.shadowAgreements}/${cap.shadowRuns}`
                        : `${t("Served")} ${cap.served}`}
                      {cap.rejections > 0 ? ` · ${t("Rejected")} ${cap.rejections}` : ""}
                      {cap.source === "jev" ? " · Jev" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
      )}
      {!learning.loading && capabilities.length === 0 && learning.enabled && (
        <p className="text-xs text-text-muted">{t("Nothing learned yet. A question needs two equivalent answers to start being validated.")}</p>
      )}
    </section>
  );
}
