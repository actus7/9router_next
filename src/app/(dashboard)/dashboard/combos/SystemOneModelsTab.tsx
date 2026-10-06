"use client";

import Card from "@/shared/components/Card";
import { InfoButton } from "@/shared/components/InfoButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemOneModels } from "@/shared/hooks/useSystemOneModels";
import { translate } from "@/i18n/runtime";
import { Cpu } from "lucide-react";
import type { Strategy } from "./combo-types";

function t(text: string): string {
  return translate(text) || text;
}

/** Why the list shows only the built-in fallback; null when the gateway answered. */
function fallbackNotice(error: string | undefined): string | null {
  switch (error) {
    case "no_key":
      return t("Connect Vercel AI Gateway in Providers to list the System One models available to you.");
    case "http":
    case "network":
      return t("Could not reach the Vercel AI Gateway; showing Jev only.");
    case "empty":
      return t("The Vercel AI Gateway listed no System One models; showing Jev only.");
    default:
      return null;
  }
}

/** The fusion combos whose judge is this model. */
function judgedBy(modelId: string, comboStrategies: Record<string, Strategy>): string[] {
  return Object.entries(comboStrategies)
    .filter(([, strategy]) => strategy.fallbackStrategy === "fusion" && strategy.judgeModel === modelId)
    .map(([name]) => name);
}

/**
 * System One models decide, they do not write: they answer typed questions
 * (yes/no, pick one, score) with calibrated probabilities. The list is the one
 * the AI Gateway reports for the account's key.
 */
export function SystemOneModelsTab({ comboStrategies }: { comboStrategies: Record<string, Strategy> }) {
  const { data, isLoading } = useSystemOneModels();
  const notice = data ? fallbackNotice(data.error) : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-main">
        {t("System One Models")}
        <InfoButton label={t("System One Models")}>
          <p>{t("System One models make decisions inside software: they receive a state and typed questions (yes/no, choose one, score) and answer with calibrated probabilities instead of generated text.")}</p>
          <p>{t("As a Fusion judge, a System One model picks the best answer from the panel and returns it as is — it does not synthesize. When it is not confident enough, the combo falls back to the LLM judge.")}</p>
        </InfoButton>
      </h2>

      {notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-text-muted">{notice}</p>}

      {isLoading || !data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.models.map((model) => {
            const combos = judgedBy(model.id, comboStrategies);
            return (
              <li key={model.id}>
                <Card padding="sm">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Cpu aria-hidden="true" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-main">{model.name}</span>
                        <code className="truncate font-mono text-xs text-text-muted">{model.id}</code>
                      </div>
                      {model.description && (
                        <p className="mt-1 text-xs text-text-muted">{model.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                        <span className="font-medium">{t("Judge of")}</span>
                        {combos.length === 0
                          ? <span className="italic">{t("no combo yet")}</span>
                          : combos.map((name) => (
                            <code key={name} className="rounded-md bg-muted px-2 py-0.5 font-mono">{name}</code>
                          ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
