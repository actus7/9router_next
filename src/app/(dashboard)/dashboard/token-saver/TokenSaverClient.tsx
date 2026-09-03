"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { getCurrentLocale, onLocaleChange, translate } from "@/i18n/runtime";
import { CAVEMAN_LEVELS, PONYTAIL_LEVELS, SYNAPSE_LEVELS } from "../endpoint/endpointConstants";
import { Zap } from "lucide-react";
import { usePxpipe } from "./hooks/usePxpipe";
import { useTokenSaverSettings } from "./hooks/useTokenSaverSettings";
import PxpipeSection from "./sections/PxpipeSection";
import PxpipeModal from "./sections/PxpipeModal";

function t(text: string): string {
  return translate(text) || text;
}

export default function TokenSaverClient() {
  const settings = useTokenSaverSettings();
  const pxpipe = usePxpipe();
  const { data } = useSWR<Record<string, unknown>>("/api/settings", jsonFetcher);
  const statusChecksStartedRef = useRef(false);
  const [, setLocaleTick] = useState(() => getCurrentLocale());

  useEffect(() => onLocaleChange(() => setLocaleTick(getCurrentLocale())), []);

  useEffect(() => {
    if (!data) return;
    settings.setRtkEnabledState(data.rtkEnabled !== false);
    settings.setCavemanEnabled(!!data.cavemanEnabled);
    settings.setCavemanLevel((data.cavemanLevel as string) || "full");
    settings.setPonytailEnabled(!!data.ponytailEnabled);
    settings.setPonytailLevel((data.ponytailLevel as string) || "full");
    settings.setSynapseEnabled(!!data.synapseEnabled);
    settings.setSynapseLevel((data.synapseLevel as string) || "lite");
    pxpipe.setPxpipeEnabled(!!data.pxpipeEnabled);
    if (typeof data.pxpipeMinChars === "number") pxpipe.setPxpipeMinChars(data.pxpipeMinChars);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; only settings data should hydrate local state
  }, [data]);

  useEffect(() => {
    if (statusChecksStartedRef.current) return;
    statusChecksStartedRef.current = true;
    pxpipe.refreshPxpipeStatus().then(pxpipe.runPxpipeHealth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status callbacks are stable useCallback([]) references
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="size-4" />
            {t("Token Saver")}
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {t("Compress tool output")}{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              {t("git/grep/ls/tree/logs → 60-90% fewer input tokens")}
            </p>
          </div>
          <Switch
            checked={settings.rtkEnabled}
            onCheckedChange={() => settings.handleRtkEnabled(!settings.rtkEnabled)}
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {t("Compress LLM output")}{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              {t("Terse-style system prompt → ~65% fewer output tokens (up to 87%)")}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {settings.cavemanEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {settings.visibleCavemanLevels.map((lvl) => (
                    <Button
                      key={lvl.id}
                      variant={settings.cavemanLevel === lvl.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => settings.handleCavemanLevel(lvl.id)}
                      title={t(lvl.desc)}
                    >
                      {t(lvl.label)}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {t(
                    CAVEMAN_LEVELS.find((lvl) => lvl.id === settings.cavemanLevel)?.desc || "",
                  )}
                </p>
              </div>
            )}
            <Switch
              checked={settings.cavemanEnabled}
              onCheckedChange={() => settings.handleCavemanEnabled(!settings.cavemanEnabled)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {t("Lazy senior dev")}{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              {t("Bias the model toward minimal code: YAGNI, reuse stdlib, deletion over addition")}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {settings.ponytailEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
                    <Button
                      key={lvl.id}
                      variant={settings.ponytailLevel === lvl.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => settings.handlePonytailLevel(lvl.id)}
                      title={t(lvl.desc)}
                    >
                      {t(lvl.label)}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {t(
                    PONYTAIL_LEVELS.find((lvl) => lvl.id === settings.ponytailLevel)?.desc || "",
                  )}
                </p>
              </div>
            )}
            <Switch
              checked={settings.ponytailEnabled}
              onCheckedChange={() => settings.handlePonytailEnabled(!settings.ponytailEnabled)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {t("Trivial local responses")}{" "}
              <a
                href="https://github.com/actus7/synapse"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Synapse)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              {t(
                "Answers greetings, thanks and goodbyes at the gateway without spending tokens; with no clear match, the message continues to the model. Never runs in tool conversations",
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {settings.synapseEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {SYNAPSE_LEVELS.map((lvl) => (
                    <Button
                      key={lvl.id}
                      variant={settings.synapseLevel === lvl.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => settings.handleSynapseLevel(lvl.id)}
                      title={t(lvl.desc)}
                    >
                      {t(lvl.label)}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {t(
                    SYNAPSE_LEVELS.find((lvl) => lvl.id === settings.synapseLevel)?.desc || "",
                  )}
                </p>
              </div>
            )}
            <Switch
              checked={settings.synapseEnabled}
              onCheckedChange={() => settings.handleSynapseEnabled(!settings.synapseEnabled)}
            />
          </div>
        </div>

        <PxpipeSection
          pxpipeEnabled={pxpipe.pxpipeEnabled}
          pxpipeStatus={pxpipe.pxpipeStatus}
          pxpipeStatusLabel={pxpipe.pxpipeStatusLabel}
          pxpipeChipClass={pxpipe.pxpipeChipClass}
          setShowPxpipeModal={pxpipe.setShowPxpipeModal}
          handlePxpipeEnabled={pxpipe.handlePxpipeEnabled}
        />
      </Card>

      <PxpipeModal
        showPxpipeModal={pxpipe.showPxpipeModal}
        setShowPxpipeModal={pxpipe.setShowPxpipeModal}
        pxpipeStatus={pxpipe.pxpipeStatus}
        pxpipeHealthy={pxpipe.pxpipeHealthy}
        pxpipeStatusLabel={pxpipe.pxpipeStatusLabel}
        pxpipeHealth={pxpipe.pxpipeHealth}
        pxpipeMinChars={pxpipe.pxpipeMinChars}
        setPxpipeMinChars={pxpipe.setPxpipeMinChars}
        handlePxpipeMinCharsBlur={pxpipe.handlePxpipeMinCharsBlur}
        pxpipeActionLoading={pxpipe.pxpipeActionLoading}
        pxpipeActionError={pxpipe.pxpipeActionError}
        pxpipeAction={pxpipe.pxpipeAction}
        refreshPxpipeStatus={pxpipe.refreshPxpipeStatus}
        runPxpipeHealth={pxpipe.runPxpipeHealth}
      />
    </div>
  );
}
