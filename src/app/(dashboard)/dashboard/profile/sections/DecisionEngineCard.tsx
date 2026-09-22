"use client";

import { useState } from "react";
import Card from "@/shared/components/Card";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BrainCircuit, CheckCircle2, ExternalLink } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { Settings } from "../types";
import type { JevFeatureKey, useDecisionEngine } from "../hooks/useDecisionEngine";

// `translate` returns null for an unknown literal; ARIA props want a string.
const t = (text: string): string => translate(text) ?? text;

// Where the key is created. Same URL the Vercel AI Gateway provider card uses.
const GATEWAY_KEY_URL = "https://vercel.com/dashboard/~/ai-gateway";

const FEATURES: Array<{ key: JevFeatureKey; title: string; description: string }> = [
  {
    key: "jevSmartRouting",
    title: "Smart routing classifier",
    description: "Jev picks the tier and capability of ambiguous requests in smart combos, instead of an LLM call.",
  },
  {
    key: "jevMemoryReview",
    title: "Memory review",
    description: "Jev decides whether a message states something worth remembering, instead of keyword matching.",
  },
  {
    key: "jevPluginSelection",
    title: "Per-turn plugin selection",
    description: "Before each chat turn, Jev drops tools that clearly do not apply. Fewer tokens; a wrong drop costs quality.",
  },
  {
    key: "jevWriteRisk",
    title: "Risk of pending writes",
    description: "Jev rates how risky each agent write awaiting approval is. Advisory only: you still approve or reject.",
  },
];

interface DecisionEngineCardProps {
  settings: Settings;
  loading: boolean;
  engine: ReturnType<typeof useDecisionEngine>;
}

export default function DecisionEngineCard({ settings, loading, engine }: DecisionEngineCardProps) {
  const [apiKey, setApiKey] = useState("");
  const isJev = settings.decisionEngine === "jev";

  const handleConnect = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await engine.connectGatewayKey(apiKey)) setApiKey("");
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-info text-info-foreground shrink-0">
          <BrainCircuit className="size-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">{t("Decision engine")}</h3>
          <p className="text-xs sm:text-sm text-text-muted">
            {t("Who makes the platform's quick decisions: built-in heuristics, or the Jev model (TypeSafe AI) through your Vercel AI Gateway.")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label={t("Decision engine")} className="grid grid-cols-2 gap-2">
          {(["heuristic", "jev"] as const).map((value) => (
            <Button
              key={value}
              role="radio"
              aria-checked={(value === "jev") === isJev}
              variant={(value === "jev") === isJev ? "primary" : "outline"}
              disabled={loading}
              onClick={() => engine.setEngine(value)}
            >
              {value === "jev" ? t("AI (Jev)") : t("Heuristic")}
            </Button>
          ))}
        </div>

        {isJev && (
          <>
            <div className="pt-2 border-t border-border/50">
              {engine.hasGatewayKey ? (
                <p className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-success shrink-0" />
                  {t("Using the key of your Vercel AI Gateway connection.")}
                </p>
              ) : engine.hasGatewayKey === false ? (
                <form onSubmit={handleConnect} className="flex flex-col gap-3">
                  <p className="text-sm">
                    {t("Jev needs a Vercel AI Gateway API key. Create one in AI Gateway → API Keys, then paste it here. It is saved encrypted to this account and also enables the gateway's models.")}
                  </p>
                  <a
                    href={GATEWAY_KEY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline w-fit"
                  >
                    {t("Create key on Vercel")}
                    <ExternalLink className="size-3.5" />
                  </a>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="vck_…"
                      aria-label={t("Vercel AI Gateway API key")}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      disabled={engine.connecting}
                    />
                    <Button type="submit" variant="primary" loading={engine.connecting} disabled={!apiKey.trim()}>
                      {t("Save key")}
                    </Button>
                  </div>
                  {engine.error && <p className="text-sm text-destructive">{t(engine.error)}</p>}
                </form>
              ) : null}
              <p className="mt-2 text-xs text-text-muted">
                {t("Jev calls are billed to your Vercel AI Gateway. When Jev is unreachable, every feature falls back to the heuristic.")}
              </p>
            </div>

            <div className="flex flex-col gap-4 pt-2 border-t border-border/50">
              {FEATURES.map((feature) => (
                <div key={feature.key} className="flex items-start sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm sm:text-base">{t(feature.title)}</p>
                    <p className="text-xs sm:text-sm text-text-muted">{t(feature.description)}</p>
                  </div>
                  <Switch
                    aria-label={t(feature.title)}
                    checked={settings[feature.key] === true}
                    onCheckedChange={(checked) => engine.setFeature(feature.key, checked)}
                    disabled={loading}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
